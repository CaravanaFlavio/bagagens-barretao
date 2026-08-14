import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import type {
  CityTransfer,
  Luggage,
  LuggageMovement,
  OperationClosure,
  Passenger,
  PassengerImportBatch,
  PhotoRecord,
} from '../domain/types'
import { compressPhotoBlob } from '../utils/imageCompression'
import { getDatabase } from './appDatabase'
import { firestore } from './firebaseConfig'

const PASSENGERS_COLLECTION = 'passengers'
const LUGGAGE_COLLECTION = 'luggage'
const MOVEMENTS_COLLECTION = 'movements'
const OPERATION_CLOSURES_COLLECTION = 'operationClosures'
const CITY_TRANSFERS_COLLECTION = 'cityTransfers'
const PASSENGER_IMPORT_BATCHES_COLLECTION = 'passengerImportBatches'
const PHOTO_METADATA_COLLECTION = 'photos'
const PHOTO_FILES_COLLECTION = 'photoFiles'
const METADATA_COLLECTION = 'appMetadata'

const BOOTSTRAP_METADATA_KEY = 'cloud-sync-bootstrap-v1'
const LAST_SYNCED_PASSENGER_IDS_KEY = 'cloud-sync-last-passenger-ids-v1'
const LAST_SYNCED_LUGGAGE_IDS_KEY = 'cloud-sync-last-luggage-ids-v1'
const LAST_SYNCED_MOVEMENT_IDS_KEY = 'cloud-sync-last-movement-ids-v1'
const LAST_SYNCED_CLOSURE_IDS_KEY = 'cloud-sync-last-operation-closure-ids-v1'
const LAST_SYNCED_TRANSFER_IDS_KEY = 'cloud-sync-last-city-transfer-ids-v1'
const LAST_SYNCED_IMPORT_BATCH_IDS_KEY = 'cloud-sync-last-import-batch-ids-v1'
const LAST_SYNCED_PHOTO_IDS_KEY = 'cloud-sync-last-photo-ids-v1'

const LOCAL_SCAN_INTERVAL_MS = 1500
const MAX_CLOUD_PHOTO_BYTES = 350_000
const FIRESTORE_BATCH_LIMIT = 450

interface AppMetadataRecord {
  key: string
  value: string
  updatedAt: string
}

interface CloudPhotoMetadata {
  id: string
  kind: PhotoRecord['kind']
  passengerId: string
  luggageId: string
  operationKey?: PhotoRecord['operationKey']
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  createdAt: string
  updatedAt: string
}

interface SimpleSyncOptions<T extends { id: string }> {
  collectionName: string
  metadataKey: string
  parse: (id: string, data: DocumentData) => T | null
  timestamp: (record: T) => string
  loadLocal: () => Promise<T[]>
  putLocal: (record: T) => Promise<unknown>
  deleteLocal: (id: string) => Promise<unknown>
  getPreviousIds: () => Set<string>
  setPreviousIds: (ids: Set<string>) => void
  cloudUpdatedAt: Map<string, string>
}

export interface CloudInspection {
  online: boolean
  localPassengerCount: number
  cloudPassengerCount: number | null
  bootstrapped: boolean
}

let passengerUnsubscribe: Unsubscribe | null = null
let luggageUnsubscribe: Unsubscribe | null = null
let movementUnsubscribe: Unsubscribe | null = null
let closureUnsubscribe: Unsubscribe | null = null
let transferUnsubscribe: Unsubscribe | null = null
let importBatchUnsubscribe: Unsubscribe | null = null
let photoUnsubscribe: Unsubscribe | null = null
let metadataUnsubscribe: Unsubscribe | null = null

let localScanTimer: number | null = null
let onlineListener: (() => void) | null = null
let syncStarted = false
let bootstrapInFlight: Promise<void> | null = null

let previousLocalPassengerIds = new Set<string>()
let previousLocalLuggageIds = new Set<string>()
let previousLocalMovementIds = new Set<string>()
let previousLocalClosureIds = new Set<string>()
let previousLocalTransferIds = new Set<string>()
let previousLocalImportBatchIds = new Set<string>()
let previousLocalPhotoIds = new Set<string>()
let previousLocalMetadataKeys = new Set<string>()

const cloudPassengerUpdatedAt = new Map<string, string>()
const cloudLuggageUpdatedAt = new Map<string, string>()
const cloudMovementUpdatedAt = new Map<string, string>()
const cloudClosureUpdatedAt = new Map<string, string>()
const cloudTransferUpdatedAt = new Map<string, string>()
const cloudImportBatchUpdatedAt = new Map<string, string>()
const cloudPhotoUpdatedAt = new Map<string, string>()
const cloudMetadataUpdatedAt = new Map<string, string>()

let photoSyncTail: Promise<void> = Promise.resolve()

function queuePhotoSync(task: () => Promise<void>) {
  const run = photoSyncTail.then(task, task)
  photoSyncTail = run.catch(() => undefined)
  return run
}

function now() {
  return new Date().toISOString()
}

function isSyncInternalMetadata(key: string) {
  return key.startsWith('cloud-sync-')
}

function asPassenger(id: string, data: DocumentData): Passenger | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.fullName !== 'string') return null
  if (typeof data.updatedAt !== 'string') return null
  return { ...data, id } as Passenger
}

function asLuggage(id: string, data: DocumentData): Luggage | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.passengerId !== 'string') return null
  if (typeof data.normalizedCode !== 'string') return null
  if (typeof data.updatedAt !== 'string') return null
  return { ...data, id } as Luggage
}

function asMovement(id: string, data: DocumentData): LuggageMovement | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.luggageId !== 'string') return null
  if (typeof data.occurredAt !== 'string') return null
  return { ...data, id } as LuggageMovement
}

function asOperationClosure(id: string, data: DocumentData): OperationClosure | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.operationKey !== 'string') return null
  if (typeof data.finalizedAt !== 'string') return null
  return { ...data, id } as OperationClosure
}

function asCityTransfer(id: string, data: DocumentData): CityTransfer | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.city !== 'string') return null
  if (typeof data.updatedAt !== 'string') return null
  return { ...data, id } as CityTransfer
}

function asPassengerImportBatch(id: string, data: DocumentData): PassengerImportBatch | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.fingerprint !== 'string') return null
  if (typeof data.importedAt !== 'string') return null
  return { ...data, id } as PassengerImportBatch
}

function asPhotoMetadata(id: string, data: DocumentData): CloudPhotoMetadata | null {
  if (!data || typeof data !== 'object') return null

  const kind = data.kind
  if (
    kind !== 'PASSENGER_SET' &&
    kind !== 'LUGGAGE_DETAIL' &&
    kind !== 'OPERATION_EVIDENCE'
  ) {
    return null
  }

  if (typeof data.passengerId !== 'string') return null
  if (typeof data.luggageId !== 'string') return null
  if (typeof data.mimeType !== 'string') return null
  if (typeof data.sizeBytes !== 'number') return null
  if (typeof data.width !== 'number') return null
  if (typeof data.height !== 'number') return null
  if (typeof data.createdAt !== 'string') return null
  if (typeof data.updatedAt !== 'string') return null
  if (data.operationKey !== undefined && typeof data.operationKey !== 'string') {
    return null
  }

  return {
    id,
    kind,
    passengerId: data.passengerId,
    luggageId: data.luggageId,
    operationKey: data.operationKey as PhotoRecord['operationKey'],
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    width: data.width,
    height: data.height,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}

function asMetadata(id: string, data: DocumentData): AppMetadataRecord | null {
  if (!data || typeof data !== 'object') return null
  const key = typeof data.key === 'string' ? data.key : id
  if (typeof data.value !== 'string' || typeof data.updatedAt !== 'string') return null
  return { key, value: data.value, updatedAt: data.updatedAt }
}

function manualPassengerChangeAfterImport(passenger: Passenger) {
  if (!passenger.importedAt) return true
  const lastImportTimestamp = passenger.lastUpdatedFromImportAt ?? passenger.importedAt
  return passenger.updatedAt > lastImportTimestamp
}

async function isBootstrappedLocally() {
  const database = await getDatabase()
  return Boolean(await database.get('appMetadata', BOOTSTRAP_METADATA_KEY))
}

async function markBootstrappedLocally() {
  const database = await getDatabase()
  const timestamp = now()
  await database.put('appMetadata', {
    key: BOOTSTRAP_METADATA_KEY,
    value: timestamp,
    updatedAt: timestamp,
  })
}

async function loadLastSyncedIds(metadataKey: string) {
  const database = await getDatabase()
  const record = await database.get('appMetadata', metadataKey)
  if (!record?.value) return new Set<string>()

  try {
    const parsed = JSON.parse(record.value) as unknown
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set<string>()
  }
}

async function saveLastSyncedIds(metadataKey: string, ids: Iterable<string>) {
  const database = await getDatabase()
  const timestamp = now()
  await database.put('appMetadata', {
    key: metadataKey,
    value: JSON.stringify(Array.from(ids).sort()),
    updatedAt: timestamp,
  })
}

async function renamePassengerLocally(
  previousId: string,
  canonicalPassenger: Passenger,
) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['passengers', 'luggage', 'photos', 'operationClosures'],
    'readwrite',
  )
  const passengerStore = transaction.objectStore('passengers')
  const luggageStore = transaction.objectStore('luggage')
  const photoStore = transaction.objectStore('photos')
  const closureStore = transaction.objectStore('operationClosures')

  const luggage = await luggageStore.index('by-passenger').getAll(previousId)
  for (const item of luggage) {
    await luggageStore.put({ ...item, passengerId: canonicalPassenger.id })
  }

  const photos = await photoStore.index('by-passenger').getAll(previousId)
  for (const photo of photos) {
    await photoStore.put({ ...photo, passengerId: canonicalPassenger.id })
  }

  const closures = await closureStore.getAll()
  for (const closure of closures) {
    if (!closure.passengerIdsWithoutLuggage.includes(previousId)) continue
    await closureStore.put({
      ...closure,
      passengerIdsWithoutLuggage: closure.passengerIdsWithoutLuggage.map((id: string) =>
        id === previousId ? canonicalPassenger.id : id,
      ),
    })
  }

  if (previousId !== canonicalPassenger.id) {
    await passengerStore.delete(previousId)
  }
  await passengerStore.put(canonicalPassenger)
  await transaction.done
}

async function renameLuggageLocally(
  previousId: string,
  canonicalLuggage: Luggage,
) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['luggage', 'movements', 'photos', 'cityTransfers', 'operationClosures'],
    'readwrite',
  )
  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const transferStore = transaction.objectStore('cityTransfers')
  const closureStore = transaction.objectStore('operationClosures')

  const movements = await movementStore.index('by-luggage').getAll(previousId)
  for (const movement of movements) {
    await movementStore.put({ ...movement, luggageId: canonicalLuggage.id })
  }

  const photos = await photoStore.index('by-luggage').getAll(previousId)
  for (const photo of photos) {
    await photoStore.put({ ...photo, luggageId: canonicalLuggage.id })
  }

  const replaceId = (ids: string[]) =>
    ids.map((id: string) => (id === previousId ? canonicalLuggage.id : id))

  const transfers = await transferStore.getAll()
  for (const transfer of transfers) {
    if (
      !transfer.scannedLuggageIds.includes(previousId) &&
      !transfer.expectedLuggageIds.includes(previousId) &&
      !transfer.missingLuggageIds.includes(previousId)
    ) {
      continue
    }

    await transferStore.put({
      ...transfer,
      scannedLuggageIds: replaceId(transfer.scannedLuggageIds),
      expectedLuggageIds: replaceId(transfer.expectedLuggageIds),
      missingLuggageIds: replaceId(transfer.missingLuggageIds),
    })
  }

  const closures = await closureStore.getAll()
  for (const closure of closures) {
    if (
      !closure.remainingLuggageIds.includes(previousId) &&
      !closure.unexpectedLuggageIds.includes(previousId)
    ) {
      continue
    }

    await closureStore.put({
      ...closure,
      remainingLuggageIds: replaceId(closure.remainingLuggageIds),
      unexpectedLuggageIds: replaceId(closure.unexpectedLuggageIds),
    })
  }

  if (previousId !== canonicalLuggage.id) {
    await luggageStore.delete(previousId)
  }
  await luggageStore.put(canonicalLuggage)
  await transaction.done
}

async function renameImportBatchLocally(
  previousId: string,
  canonicalBatch: PassengerImportBatch,
) {
  const database = await getDatabase()
  const transaction = database.transaction('passengerImportBatches', 'readwrite')
  const store = transaction.objectStore('passengerImportBatches')

  if (previousId !== canonicalBatch.id) {
    await store.delete(previousId)
  }
  await store.put(canonicalBatch)
  await transaction.done
}

async function deletePassengerLocally(passengerId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['passengers', 'luggage', 'movements', 'photos', 'cityTransfers', 'operationClosures'],
    'readwrite',
  )
  const passengerStore = transaction.objectStore('passengers')
  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const transferStore = transaction.objectStore('cityTransfers')
  const closureStore = transaction.objectStore('operationClosures')

  const passengerLuggage = await luggageStore.index('by-passenger').getAll(passengerId)
  const luggageIds = new Set<string>(passengerLuggage.map((item: Luggage) => item.id))

  for (const luggage of passengerLuggage) {
    const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggage.id)
    for (const movementId of movementKeys) {
      await movementStore.delete(movementId)
    }

    const photoKeys = await photoStore.index('by-luggage').getAllKeys(luggage.id)
    for (const photoId of photoKeys) {
      await photoStore.delete(photoId)
    }

    await luggageStore.delete(luggage.id)
  }

  const passengerPhotoKeys = await photoStore.index('by-passenger').getAllKeys(passengerId)
  for (const photoId of passengerPhotoKeys) {
    await photoStore.delete(photoId)
  }

  const transfers = await transferStore.getAll()
  for (const transfer of transfers) {
    const removeIds = (ids: string[]) => ids.filter((id) => !luggageIds.has(id))
    await transferStore.put({
      ...transfer,
      scannedLuggageIds: removeIds(transfer.scannedLuggageIds),
      expectedLuggageIds: removeIds(transfer.expectedLuggageIds),
      missingLuggageIds: removeIds(transfer.missingLuggageIds),
      updatedAt: now(),
    })
  }

  const closures = await closureStore.getAll()
  for (const closure of closures) {
    if (!closure.passengerIdsWithoutLuggage.includes(passengerId)) continue
    await closureStore.put({
      ...closure,
      passengerIdsWithoutLuggage: closure.passengerIdsWithoutLuggage.filter(
        (id: string) => id !== passengerId,
      ),
    })
  }

  await passengerStore.delete(passengerId)
  await transaction.done
}

async function deleteLuggageLocally(luggageId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['luggage', 'movements', 'photos', 'cityTransfers', 'operationClosures'],
    'readwrite',
  )
  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const transferStore = transaction.objectStore('cityTransfers')
  const closureStore = transaction.objectStore('operationClosures')

  const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggageId)
  for (const movementId of movementKeys) {
    await movementStore.delete(movementId)
  }

  const photoKeys = await photoStore.index('by-luggage').getAllKeys(luggageId)
  for (const photoId of photoKeys) {
    await photoStore.delete(photoId)
  }

  const removeId = (ids: string[]) => ids.filter((id) => id !== luggageId)

  const transfers = await transferStore.getAll()
  for (const transfer of transfers) {
    if (
      !transfer.scannedLuggageIds.includes(luggageId) &&
      !transfer.expectedLuggageIds.includes(luggageId) &&
      !transfer.missingLuggageIds.includes(luggageId)
    ) {
      continue
    }

    await transferStore.put({
      ...transfer,
      scannedLuggageIds: removeId(transfer.scannedLuggageIds),
      expectedLuggageIds: removeId(transfer.expectedLuggageIds),
      missingLuggageIds: removeId(transfer.missingLuggageIds),
      updatedAt: now(),
    })
  }

  const closures = await closureStore.getAll()
  for (const closure of closures) {
    if (
      !closure.remainingLuggageIds.includes(luggageId) &&
      !closure.unexpectedLuggageIds.includes(luggageId)
    ) {
      continue
    }

    await closureStore.put({
      ...closure,
      remainingLuggageIds: removeId(closure.remainingLuggageIds),
      unexpectedLuggageIds: removeId(closure.unexpectedLuggageIds),
    })
  }

  await luggageStore.delete(luggageId)
  await transaction.done
}

async function commitRecords<T extends { id: string }>(
  collectionName: string,
  records: T[],
) {
  for (let index = 0; index < records.length; index += FIRESTORE_BATCH_LIMIT) {
    const chunk = records.slice(index, index + FIRESTORE_BATCH_LIMIT)
    const batch = writeBatch(firestore)

    for (const record of chunk) {
      batch.set(
        doc(firestore, collectionName, record.id),
        { ...record } as DocumentData,
      )
    }

    await batch.commit()
  }
}

async function commitPassengers(passengers: Passenger[]) {
  await commitRecords(PASSENGERS_COLLECTION, passengers)
}

async function commitMetadata(records: AppMetadataRecord[]) {
  const syncable = records.filter((record) => !isSyncInternalMetadata(record.key))
  for (let index = 0; index < syncable.length; index += FIRESTORE_BATCH_LIMIT) {
    const chunk = syncable.slice(index, index + FIRESTORE_BATCH_LIMIT)
    const batch = writeBatch(firestore)

    for (const record of chunk) {
      batch.set(doc(firestore, METADATA_COLLECTION, record.key), record)
    }

    await batch.commit()
  }
}

export async function inspectCloudSync(): Promise<CloudInspection> {
  const database = await getDatabase()
  const [localPassengers, bootstrapped] = await Promise.all([
    database.count('passengers'),
    isBootstrappedLocally(),
  ])

  if (!navigator.onLine) {
    return {
      online: false,
      localPassengerCount: localPassengers,
      cloudPassengerCount: null,
      bootstrapped,
    }
  }

  const cloudSnapshot = await getDocsFromServer(collection(firestore, PASSENGERS_COLLECTION))
  return {
    online: true,
    localPassengerCount: localPassengers,
    cloudPassengerCount: cloudSnapshot.size,
    bootstrapped,
  }
}

export async function seedCloudFromThisDevice() {
  if (!navigator.onLine) {
    throw new Error('A primeira carga da nuvem precisa de conexão com a internet.')
  }

  const cloudSnapshot = await getDocsFromServer(collection(firestore, PASSENGERS_COLLECTION))
  if (!cloudSnapshot.empty) {
    throw new Error('A nuvem já possui passageiros. A carga inicial foi cancelada por segurança.')
  }

  const database = await getDatabase()
  const [
    passengers,
    luggage,
    movements,
    closures,
    transfers,
    importBatches,
    photos,
    metadata,
  ] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
    database.getAll('operationClosures'),
    database.getAll('cityTransfers'),
    database.getAll('passengerImportBatches'),
    database.getAll('photos'),
    database.getAll('appMetadata') as Promise<AppMetadataRecord[]>,
  ])

  if (passengers.length === 0) {
    throw new Error('Este dispositivo não possui passageiros para enviar à nuvem.')
  }

  await commitPassengers(passengers)
  await commitRecords(LUGGAGE_COLLECTION, luggage)
  await commitRecords(MOVEMENTS_COLLECTION, movements)
  await commitRecords(OPERATION_CLOSURES_COLLECTION, closures)
  await commitRecords(CITY_TRANSFERS_COLLECTION, transfers)
  await commitRecords(PASSENGER_IMPORT_BATCHES_COLLECTION, importBatches)
  await commitMetadata(metadata)

  for (const photo of photos) {
    await uploadPhotoToCloud(photo)
  }

  await Promise.all([
    saveLastSyncedIds(
      LAST_SYNCED_PASSENGER_IDS_KEY,
      passengers.map((passenger) => passenger.id),
    ),
    saveLastSyncedIds(
      LAST_SYNCED_LUGGAGE_IDS_KEY,
      luggage.map((item) => item.id),
    ),
    saveLastSyncedIds(
      LAST_SYNCED_MOVEMENT_IDS_KEY,
      movements.map((movement) => movement.id),
    ),
    saveLastSyncedIds(
      LAST_SYNCED_CLOSURE_IDS_KEY,
      closures.map((closure) => closure.id),
    ),
    saveLastSyncedIds(
      LAST_SYNCED_TRANSFER_IDS_KEY,
      transfers.map((transfer) => transfer.id),
    ),
    saveLastSyncedIds(
      LAST_SYNCED_IMPORT_BATCH_IDS_KEY,
      importBatches.map((batch) => batch.id),
    ),
    saveLastSyncedIds(
      LAST_SYNCED_PHOTO_IDS_KEY,
      photos.map((photo) => photo.id),
    ),
  ])

  await markBootstrappedLocally()
  return passengers.length
}

async function reconcilePassengersFromServer() {
  const remoteSnapshot = await getDocsFromServer(collection(firestore, PASSENGERS_COLLECTION))
  const remotePassengers = remoteSnapshot.docs
    .map((snapshot) => asPassenger(snapshot.id, snapshot.data()))
    .filter((passenger): passenger is Passenger => Boolean(passenger))

  const database = await getDatabase()
  let localPassengers = await database.getAll('passengers')
  const lastSyncedIds = await loadLastSyncedIds(LAST_SYNCED_PASSENGER_IDS_KEY)

  const localById = new Map<string, Passenger>(
    localPassengers.map((passenger) => [passenger.id, passenger]),
  )
  const localBySourceKey = new Map<string, Passenger[]>()

  for (const passenger of localPassengers) {
    if (!passenger.importSourceKey) continue
    const current = localBySourceKey.get(passenger.importSourceKey) ?? []
    current.push(passenger)
    localBySourceKey.set(passenger.importSourceKey, current)
  }

  const remoteIds = new Set<string>()
  const toPush = new Map<string, Passenger>()
  const toDeleteFromCloud = new Set<string>()

  for (const remotePassenger of remotePassengers) {
    remoteIds.add(remotePassenger.id)
    cloudPassengerUpdatedAt.set(remotePassenger.id, remotePassenger.updatedAt)

    const exactLocal = localById.get(remotePassenger.id)
    if (exactLocal) {
      if (exactLocal.updatedAt > remotePassenger.updatedAt) {
        toPush.set(exactLocal.id, exactLocal)
      } else if (remotePassenger.updatedAt > exactLocal.updatedAt) {
        await database.put('passengers', remotePassenger)
      }
      continue
    }

    const sourceMatches = remotePassenger.importSourceKey
      ? localBySourceKey.get(remotePassenger.importSourceKey) ?? []
      : []

    if (sourceMatches.length === 1) {
      const localPassenger = sourceMatches[0]
      const hasLocalManualChange = manualPassengerChangeAfterImport(localPassenger)
      const canonicalPassenger = hasLocalManualChange
        ? { ...localPassenger, id: remotePassenger.id }
        : remotePassenger

      await renamePassengerLocally(localPassenger.id, canonicalPassenger)
      localById.delete(localPassenger.id)
      localById.set(canonicalPassenger.id, canonicalPassenger)

      if (hasLocalManualChange) {
        toPush.set(canonicalPassenger.id, canonicalPassenger)
      }
      continue
    }

    if (lastSyncedIds.has(remotePassenger.id)) {
      toDeleteFromCloud.add(remotePassenger.id)
      continue
    }

    await database.put('passengers', remotePassenger)
    localById.set(remotePassenger.id, remotePassenger)
  }

  localPassengers = await database.getAll('passengers')
  for (const localPassenger of localPassengers) {
    if (remoteIds.has(localPassenger.id)) continue

    if (lastSyncedIds.has(localPassenger.id)) {
      await deletePassengerLocally(localPassenger.id)
      continue
    }

    toPush.set(localPassenger.id, localPassenger)
  }

  if (toPush.size > 0) {
    await commitPassengers(Array.from(toPush.values()))
  }

  for (const passengerId of toDeleteFromCloud) {
    await deleteDoc(doc(firestore, PASSENGERS_COLLECTION, passengerId))
    cloudPassengerUpdatedAt.delete(passengerId)
  }

  localPassengers = await database.getAll('passengers')
  previousLocalPassengerIds = new Set(localPassengers.map((passenger) => passenger.id))
  await saveLastSyncedIds(LAST_SYNCED_PASSENGER_IDS_KEY, previousLocalPassengerIds)
}

async function reconcileLuggageFromServer() {
  const remoteSnapshot = await getDocsFromServer(collection(firestore, LUGGAGE_COLLECTION))
  const remoteLuggage = remoteSnapshot.docs
    .map((snapshot) => asLuggage(snapshot.id, snapshot.data()))
    .filter((item): item is Luggage => Boolean(item))

  const database = await getDatabase()
  let localLuggage = await database.getAll('luggage')
  const lastSyncedIds = await loadLastSyncedIds(LAST_SYNCED_LUGGAGE_IDS_KEY)

  const localById = new Map<string, Luggage>(
    localLuggage.map((item) => [item.id, item]),
  )
  const localByCode = new Map<string, Luggage>(
    localLuggage.map((item) => [item.normalizedCode, item]),
  )

  const remoteIds = new Set<string>()
  const toPush = new Map<string, Luggage>()
  const toDeleteFromCloud = new Set<string>()

  for (const remoteItem of remoteLuggage) {
    remoteIds.add(remoteItem.id)
    cloudLuggageUpdatedAt.set(remoteItem.id, remoteItem.updatedAt)

    const exactLocal = localById.get(remoteItem.id)
    if (exactLocal) {
      if (exactLocal.updatedAt > remoteItem.updatedAt) {
        toPush.set(exactLocal.id, exactLocal)
      } else if (remoteItem.updatedAt > exactLocal.updatedAt) {
        await database.put('luggage', remoteItem)
      }
      continue
    }

    const codeMatch = localByCode.get(remoteItem.normalizedCode)
    if (codeMatch) {
      const canonicalLuggage =
        codeMatch.updatedAt > remoteItem.updatedAt
          ? { ...codeMatch, id: remoteItem.id }
          : remoteItem

      await renameLuggageLocally(codeMatch.id, canonicalLuggage)
      localById.delete(codeMatch.id)
      localById.set(canonicalLuggage.id, canonicalLuggage)
      localByCode.set(canonicalLuggage.normalizedCode, canonicalLuggage)

      if (codeMatch.updatedAt > remoteItem.updatedAt) {
        toPush.set(canonicalLuggage.id, canonicalLuggage)
      }
      continue
    }

    if (lastSyncedIds.has(remoteItem.id)) {
      toDeleteFromCloud.add(remoteItem.id)
      continue
    }

    await database.put('luggage', remoteItem)
    localById.set(remoteItem.id, remoteItem)
    localByCode.set(remoteItem.normalizedCode, remoteItem)
  }

  localLuggage = await database.getAll('luggage')
  for (const localItem of localLuggage) {
    if (remoteIds.has(localItem.id)) continue

    if (lastSyncedIds.has(localItem.id)) {
      await deleteLuggageLocally(localItem.id)
      continue
    }

    toPush.set(localItem.id, localItem)
  }

  if (toPush.size > 0) {
    await commitRecords(LUGGAGE_COLLECTION, Array.from(toPush.values()))
  }

  for (const luggageId of toDeleteFromCloud) {
    await deleteDoc(doc(firestore, LUGGAGE_COLLECTION, luggageId))
    cloudLuggageUpdatedAt.delete(luggageId)
  }

  localLuggage = await database.getAll('luggage')
  previousLocalLuggageIds = new Set(localLuggage.map((item) => item.id))
  await saveLastSyncedIds(LAST_SYNCED_LUGGAGE_IDS_KEY, previousLocalLuggageIds)
}

async function reconcileImportBatchesFromServer() {
  const remoteSnapshot = await getDocsFromServer(
    collection(firestore, PASSENGER_IMPORT_BATCHES_COLLECTION),
  )
  const remoteBatches = remoteSnapshot.docs
    .map((snapshot) => asPassengerImportBatch(snapshot.id, snapshot.data()))
    .filter((batch): batch is PassengerImportBatch => Boolean(batch))

  const database = await getDatabase()
  let localBatches = await database.getAll('passengerImportBatches')
  const lastSyncedIds = await loadLastSyncedIds(LAST_SYNCED_IMPORT_BATCH_IDS_KEY)

  const localById = new Map<string, PassengerImportBatch>(
    localBatches.map((batch) => [batch.id, batch]),
  )
  const localByFingerprint = new Map<string, PassengerImportBatch>(
    localBatches.map((batch) => [batch.fingerprint, batch]),
  )

  const remoteIds = new Set<string>()
  const toPush = new Map<string, PassengerImportBatch>()
  const toDeleteFromCloud = new Set<string>()

  for (const remoteBatch of remoteBatches) {
    remoteIds.add(remoteBatch.id)
    cloudImportBatchUpdatedAt.set(remoteBatch.id, remoteBatch.importedAt)

    const exactLocal = localById.get(remoteBatch.id)
    if (exactLocal) {
      if (exactLocal.importedAt > remoteBatch.importedAt) {
        toPush.set(exactLocal.id, exactLocal)
      } else if (remoteBatch.importedAt > exactLocal.importedAt) {
        await database.put('passengerImportBatches', remoteBatch)
      }
      continue
    }

    const fingerprintMatch = localByFingerprint.get(remoteBatch.fingerprint)
    if (fingerprintMatch) {
      const canonicalBatch =
        fingerprintMatch.importedAt > remoteBatch.importedAt
          ? { ...fingerprintMatch, id: remoteBatch.id }
          : remoteBatch

      await renameImportBatchLocally(fingerprintMatch.id, canonicalBatch)
      localById.delete(fingerprintMatch.id)
      localById.set(canonicalBatch.id, canonicalBatch)
      localByFingerprint.set(canonicalBatch.fingerprint, canonicalBatch)

      if (fingerprintMatch.importedAt > remoteBatch.importedAt) {
        toPush.set(canonicalBatch.id, canonicalBatch)
      }
      continue
    }

    if (lastSyncedIds.has(remoteBatch.id)) {
      toDeleteFromCloud.add(remoteBatch.id)
      continue
    }

    await database.put('passengerImportBatches', remoteBatch)
    localById.set(remoteBatch.id, remoteBatch)
    localByFingerprint.set(remoteBatch.fingerprint, remoteBatch)
  }

  localBatches = await database.getAll('passengerImportBatches')
  for (const localBatch of localBatches) {
    if (remoteIds.has(localBatch.id)) continue

    if (lastSyncedIds.has(localBatch.id)) {
      await database.delete('passengerImportBatches', localBatch.id)
      continue
    }

    toPush.set(localBatch.id, localBatch)
  }

  if (toPush.size > 0) {
    await commitRecords(PASSENGER_IMPORT_BATCHES_COLLECTION, Array.from(toPush.values()))
  }

  for (const batchId of toDeleteFromCloud) {
    await deleteDoc(doc(firestore, PASSENGER_IMPORT_BATCHES_COLLECTION, batchId))
    cloudImportBatchUpdatedAt.delete(batchId)
  }

  localBatches = await database.getAll('passengerImportBatches')
  previousLocalImportBatchIds = new Set(localBatches.map((batch) => batch.id))
  await saveLastSyncedIds(
    LAST_SYNCED_IMPORT_BATCH_IDS_KEY,
    previousLocalImportBatchIds,
  )
}

async function reconcileSimpleCollection<T extends { id: string }>(
  options: SimpleSyncOptions<T>,
) {
  const remoteSnapshot = await getDocsFromServer(
    collection(firestore, options.collectionName),
  )
  const remoteRecords = remoteSnapshot.docs
    .map((snapshot) => options.parse(snapshot.id, snapshot.data()))
    .filter((record): record is T => Boolean(record))

  let localRecords = await options.loadLocal()
  const lastSyncedIds = await loadLastSyncedIds(options.metadataKey)
  const localById = new Map(localRecords.map((record) => [record.id, record]))

  const remoteIds = new Set<string>()
  const toPush = new Map<string, T>()
  const toDeleteFromCloud = new Set<string>()

  for (const remoteRecord of remoteRecords) {
    remoteIds.add(remoteRecord.id)

    const remoteTimestamp = options.timestamp(remoteRecord)
    options.cloudUpdatedAt.set(remoteRecord.id, remoteTimestamp)

    const localRecord = localById.get(remoteRecord.id)
    if (localRecord) {
      const localTimestamp = options.timestamp(localRecord)

      if (localTimestamp > remoteTimestamp) {
        toPush.set(localRecord.id, localRecord)
      } else if (remoteTimestamp > localTimestamp) {
        await options.putLocal(remoteRecord)
      }
      continue
    }

    if (lastSyncedIds.has(remoteRecord.id)) {
      toDeleteFromCloud.add(remoteRecord.id)
      continue
    }

    await options.putLocal(remoteRecord)
  }

  localRecords = await options.loadLocal()
  for (const localRecord of localRecords) {
    if (remoteIds.has(localRecord.id)) continue

    if (lastSyncedIds.has(localRecord.id)) {
      await options.deleteLocal(localRecord.id)
      continue
    }

    toPush.set(localRecord.id, localRecord)
  }

  if (toPush.size > 0) {
    await commitRecords(options.collectionName, Array.from(toPush.values()))
  }

  for (const recordId of toDeleteFromCloud) {
    await deleteDoc(doc(firestore, options.collectionName, recordId))
    options.cloudUpdatedAt.delete(recordId)
  }

  localRecords = await options.loadLocal()
  const finalIds = new Set(localRecords.map((record) => record.id))
  options.setPreviousIds(finalIds)
  await saveLastSyncedIds(options.metadataKey, finalIds)
}

async function reconcileMetadataFromServer() {
  const remoteSnapshot = await getDocsFromServer(collection(firestore, METADATA_COLLECTION))
  const database = await getDatabase()
  const localMetadata = (await database.getAll('appMetadata')) as AppMetadataRecord[]
  const localByKey = new Map<string, AppMetadataRecord>(
    localMetadata.map((record) => [record.key, record]),
  )
  const remoteKeys = new Set<string>()
  const toPush: AppMetadataRecord[] = []

  for (const snapshot of remoteSnapshot.docs) {
    const remoteRecord = asMetadata(snapshot.id, snapshot.data())
    if (!remoteRecord || isSyncInternalMetadata(remoteRecord.key)) continue

    remoteKeys.add(remoteRecord.key)
    cloudMetadataUpdatedAt.set(remoteRecord.key, remoteRecord.updatedAt)

    const localRecord = localByKey.get(remoteRecord.key)
    if (!localRecord || remoteRecord.updatedAt >= localRecord.updatedAt) {
      await database.put('appMetadata', remoteRecord)
    } else {
      toPush.push(localRecord)
    }
  }

  for (const localRecord of localMetadata) {
    if (isSyncInternalMetadata(localRecord.key)) continue
    if (!remoteKeys.has(localRecord.key)) {
      toPush.push(localRecord)
    }
  }

  if (toPush.length > 0) {
    await commitMetadata(toPush)
  }

  const currentMetadata = (await database.getAll('appMetadata')) as AppMetadataRecord[]
  previousLocalMetadataKeys = new Set(
    currentMetadata
      .filter((record) => !isSyncInternalMetadata(record.key))
      .map((record) => record.key),
  )
}

async function reconcileOperationalCollectionsFromServer() {
  const database = await getDatabase()

  await reconcileLuggageFromServer()

  await reconcileSimpleCollection<LuggageMovement>({
    collectionName: MOVEMENTS_COLLECTION,
    metadataKey: LAST_SYNCED_MOVEMENT_IDS_KEY,
    parse: asMovement,
    timestamp: (movement) => movement.occurredAt,
    loadLocal: () => database.getAll('movements'),
    putLocal: (movement) => database.put('movements', movement),
    deleteLocal: (movementId) => database.delete('movements', movementId),
    getPreviousIds: () => previousLocalMovementIds,
    setPreviousIds: (ids) => {
      previousLocalMovementIds = ids
    },
    cloudUpdatedAt: cloudMovementUpdatedAt,
  })

  await reconcileSimpleCollection<OperationClosure>({
    collectionName: OPERATION_CLOSURES_COLLECTION,
    metadataKey: LAST_SYNCED_CLOSURE_IDS_KEY,
    parse: asOperationClosure,
    timestamp: (closure) => closure.finalizedAt,
    loadLocal: () => database.getAll('operationClosures'),
    putLocal: (closure) => database.put('operationClosures', closure),
    deleteLocal: (closureId) => database.delete('operationClosures', closureId),
    getPreviousIds: () => previousLocalClosureIds,
    setPreviousIds: (ids) => {
      previousLocalClosureIds = ids
    },
    cloudUpdatedAt: cloudClosureUpdatedAt,
  })

  await reconcileSimpleCollection<CityTransfer>({
    collectionName: CITY_TRANSFERS_COLLECTION,
    metadataKey: LAST_SYNCED_TRANSFER_IDS_KEY,
    parse: asCityTransfer,
    timestamp: (transfer) => transfer.updatedAt,
    loadLocal: () => database.getAll('cityTransfers'),
    putLocal: (transfer) => database.put('cityTransfers', transfer),
    deleteLocal: (transferId) => database.delete('cityTransfers', transferId),
    getPreviousIds: () => previousLocalTransferIds,
    setPreviousIds: (ids) => {
      previousLocalTransferIds = ids
    },
    cloudUpdatedAt: cloudTransferUpdatedAt,
  })

  await reconcileImportBatchesFromServer()
}

async function ensureBootstrap() {
  if (bootstrapInFlight) return bootstrapInFlight

  bootstrapInFlight = (async () => {
    if (!navigator.onLine) return

    const remoteSnapshot = await getDocsFromServer(collection(firestore, PASSENGERS_COLLECTION))
    if (remoteSnapshot.empty) return

    await reconcilePassengersFromServer()
    await reconcileMetadataFromServer()
    await reconcileOperationalCollectionsFromServer()
    await markBootstrappedLocally()
  })().finally(() => {
    bootstrapInFlight = null
  })

  return bootstrapInFlight
}

async function scanPassengers() {
  const database = await getDatabase()
  const passengers = await database.getAll('passengers')

  if (previousLocalPassengerIds.size === 0) {
    previousLocalPassengerIds = await loadLastSyncedIds(LAST_SYNCED_PASSENGER_IDS_KEY)
  }

  const currentPassengerIds = new Set<string>(passengers.map((passenger) => passenger.id))
  for (const passenger of passengers) {
    const remoteUpdatedAt = cloudPassengerUpdatedAt.get(passenger.id)
    if (!remoteUpdatedAt || passenger.updatedAt > remoteUpdatedAt) {
      await setDoc(doc(firestore, PASSENGERS_COLLECTION, passenger.id), passenger)
      cloudPassengerUpdatedAt.set(passenger.id, passenger.updatedAt)
    }
  }

  for (const passengerId of previousLocalPassengerIds) {
    if (currentPassengerIds.has(passengerId)) continue
    await deleteDoc(doc(firestore, PASSENGERS_COLLECTION, passengerId))
    cloudPassengerUpdatedAt.delete(passengerId)
  }

  previousLocalPassengerIds = currentPassengerIds
  await saveLastSyncedIds(LAST_SYNCED_PASSENGER_IDS_KEY, previousLocalPassengerIds)
}

async function scanLuggage() {
  const database = await getDatabase()
  const luggage = await database.getAll('luggage')

  if (previousLocalLuggageIds.size === 0) {
    previousLocalLuggageIds = await loadLastSyncedIds(LAST_SYNCED_LUGGAGE_IDS_KEY)
  }

  const currentIds = new Set<string>(luggage.map((item) => item.id))
  for (const item of luggage) {
    const remoteUpdatedAt = cloudLuggageUpdatedAt.get(item.id)
    if (!remoteUpdatedAt || item.updatedAt > remoteUpdatedAt) {
      await setDoc(doc(firestore, LUGGAGE_COLLECTION, item.id), item)
      cloudLuggageUpdatedAt.set(item.id, item.updatedAt)
    }
  }

  for (const luggageId of previousLocalLuggageIds) {
    if (currentIds.has(luggageId)) continue
    await deleteDoc(doc(firestore, LUGGAGE_COLLECTION, luggageId))
    cloudLuggageUpdatedAt.delete(luggageId)
  }

  previousLocalLuggageIds = currentIds
  await saveLastSyncedIds(LAST_SYNCED_LUGGAGE_IDS_KEY, previousLocalLuggageIds)
}

async function scanSimpleCollection<T extends { id: string }>(
  options: SimpleSyncOptions<T>,
) {
  let previousIds = options.getPreviousIds()
  if (previousIds.size === 0) {
    previousIds = await loadLastSyncedIds(options.metadataKey)
  }

  const records = await options.loadLocal()
  const currentIds = new Set(records.map((record) => record.id))

  for (const record of records) {
    const localTimestamp = options.timestamp(record)
    const remoteTimestamp = options.cloudUpdatedAt.get(record.id)

    if (!remoteTimestamp || localTimestamp > remoteTimestamp) {
      await setDoc(
        doc(firestore, options.collectionName, record.id),
        { ...record } as DocumentData,
      )
      options.cloudUpdatedAt.set(record.id, localTimestamp)
    }
  }

  for (const recordId of previousIds) {
    if (currentIds.has(recordId)) continue
    await deleteDoc(doc(firestore, options.collectionName, recordId))
    options.cloudUpdatedAt.delete(recordId)
  }

  options.setPreviousIds(currentIds)
  await saveLastSyncedIds(options.metadataKey, currentIds)
}

async function scanImportBatches() {
  const database = await getDatabase()
  const batches = await database.getAll('passengerImportBatches')

  if (previousLocalImportBatchIds.size === 0) {
    previousLocalImportBatchIds = await loadLastSyncedIds(
      LAST_SYNCED_IMPORT_BATCH_IDS_KEY,
    )
  }

  const currentIds = new Set<string>(batches.map((batch) => batch.id))
  for (const batch of batches) {
    const remoteImportedAt = cloudImportBatchUpdatedAt.get(batch.id)
    if (!remoteImportedAt || batch.importedAt > remoteImportedAt) {
      await setDoc(
        doc(firestore, PASSENGER_IMPORT_BATCHES_COLLECTION, batch.id),
        batch,
      )
      cloudImportBatchUpdatedAt.set(batch.id, batch.importedAt)
    }
  }

  for (const batchId of previousLocalImportBatchIds) {
    if (currentIds.has(batchId)) continue
    await deleteDoc(doc(firestore, PASSENGER_IMPORT_BATCHES_COLLECTION, batchId))
    cloudImportBatchUpdatedAt.delete(batchId)
  }

  previousLocalImportBatchIds = currentIds
  await saveLastSyncedIds(
    LAST_SYNCED_IMPORT_BATCH_IDS_KEY,
    previousLocalImportBatchIds,
  )
}

function photoMetadata(photo: PhotoRecord): DocumentData {
  return {
    id: photo.id,
    kind: photo.kind,
    passengerId: photo.passengerId,
    luggageId: photo.luggageId,
    ...(photo.operationKey ? { operationKey: photo.operationKey } : {}),
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    width: photo.width,
    height: photo.height,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
  }
}

async function preparePhotoForCloud(photo: PhotoRecord): Promise<PhotoRecord> {
  const compressed = await compressPhotoBlob(photo.blob)

  const prepared: PhotoRecord = {
    ...photo,
    blob: compressed.blob,
    mimeType: compressed.mimeType,
    sizeBytes: compressed.sizeBytes,
    width: compressed.width,
    height: compressed.height,
  }

  if (prepared.sizeBytes > MAX_CLOUD_PHOTO_BYTES) {
    throw new Error(
      `A foto ${photo.id} ficou com ${prepared.sizeBytes} bytes e ultrapassou o limite seguro da nuvem.`,
    )
  }

  const changed =
    prepared.sizeBytes !== photo.sizeBytes ||
    prepared.mimeType !== photo.mimeType ||
    prepared.width !== photo.width ||
    prepared.height !== photo.height

  if (changed) {
    const database = await getDatabase()
    await database.put('photos', prepared)
  }

  return prepared
}

async function uploadPhotoToCloud(photo: PhotoRecord) {
  const prepared = await preparePhotoForCloud(photo)
  const bytes = new Uint8Array(await prepared.blob.arrayBuffer())
  const batch = writeBatch(firestore)

  batch.set(
    doc(firestore, PHOTO_METADATA_COLLECTION, prepared.id),
    photoMetadata(prepared),
  )
  batch.set(
    doc(firestore, PHOTO_FILES_COLLECTION, prepared.id),
    {
      photoId: prepared.id,
      bytes: Bytes.fromUint8Array(bytes),
      mimeType: prepared.mimeType,
      sizeBytes: prepared.sizeBytes,
      updatedAt: prepared.updatedAt,
    },
  )

  await batch.commit()
}

async function deletePhotoFromCloud(photoId: string) {
  await Promise.all([
    deleteDoc(doc(firestore, PHOTO_METADATA_COLLECTION, photoId)),
    deleteDoc(doc(firestore, PHOTO_FILES_COLLECTION, photoId)),
  ])
}

function photoNeedsCloudRefresh(
  local: PhotoRecord,
  remote: CloudPhotoMetadata,
) {
  if (remote.updatedAt > local.updatedAt) return true
  if (remote.updatedAt < local.updatedAt) return false

  return (
    remote.sizeBytes !== local.sizeBytes ||
    remote.mimeType !== local.mimeType ||
    remote.width !== local.width ||
    remote.height !== local.height
  )
}

async function downloadPhotoFromCloud(metadata: CloudPhotoMetadata) {
  const fileSnapshot = await getDoc(
    doc(firestore, PHOTO_FILES_COLLECTION, metadata.id),
  )

  if (!fileSnapshot.exists()) {
    throw new Error(`Os bytes da foto ${metadata.id} ainda não estão disponíveis na nuvem.`)
  }

  const data = fileSnapshot.data()
  const cloudBytes = data.bytes
  if (!cloudBytes || typeof cloudBytes.toUint8Array !== 'function') {
    throw new Error(`O arquivo da foto ${metadata.id} está em formato inválido.`)
  }

  const sourceBytes = cloudBytes.toUint8Array() as Uint8Array
  const copiedBytes = new Uint8Array(sourceBytes.byteLength)
  copiedBytes.set(sourceBytes)

  if (copiedBytes.byteLength > MAX_CLOUD_PHOTO_BYTES) {
    throw new Error(
      `A foto ${metadata.id} ultrapassa o limite seguro de ${MAX_CLOUD_PHOTO_BYTES} bytes.`,
    )
  }

  const mimeType =
    typeof data.mimeType === 'string' && data.mimeType.startsWith('image/')
      ? data.mimeType
      : metadata.mimeType

  const photo: PhotoRecord = {
    id: metadata.id,
    kind: metadata.kind,
    passengerId: metadata.passengerId,
    luggageId: metadata.luggageId,
    ...(metadata.operationKey ? { operationKey: metadata.operationKey } : {}),
    blob: new Blob([copiedBytes.buffer], { type: mimeType }),
    mimeType,
    sizeBytes: copiedBytes.byteLength,
    width: metadata.width,
    height: metadata.height,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  }

  const database = await getDatabase()
  await database.put('photos', photo)

  previousLocalPhotoIds.add(photo.id)
  cloudPhotoUpdatedAt.set(photo.id, photo.updatedAt)
}

async function scanPhotosNow() {
  const database = await getDatabase()

  if (previousLocalPhotoIds.size === 0) {
    previousLocalPhotoIds = await loadLastSyncedIds(LAST_SYNCED_PHOTO_IDS_KEY)
  }

  const photoIds = (await database.getAllKeys('photos')).map(String)
  const currentIds = new Set(photoIds)
  const syncedIds = new Set(previousLocalPhotoIds)

  for (const photoId of currentIds) {
    if (syncedIds.has(photoId)) continue

    const photo = await database.get('photos', photoId)
    if (!photo) continue

    const remoteUpdatedAt = cloudPhotoUpdatedAt.get(photoId)
    if (remoteUpdatedAt && remoteUpdatedAt >= photo.updatedAt) {
      syncedIds.add(photoId)
      continue
    }

    try {
      await uploadPhotoToCloud(photo)
      cloudPhotoUpdatedAt.set(photoId, photo.updatedAt)
      syncedIds.add(photoId)
    } catch (error) {
      console.error(`Falha ao enviar a foto ${photoId} para a nuvem:`, error)
    }
  }

  for (const photoId of previousLocalPhotoIds) {
    if (currentIds.has(photoId)) continue

    try {
      await deletePhotoFromCloud(photoId)
      cloudPhotoUpdatedAt.delete(photoId)
      syncedIds.delete(photoId)
    } catch (error) {
      console.error(`Falha ao remover a foto ${photoId} da nuvem:`, error)
    }
  }

  previousLocalPhotoIds = syncedIds
  await saveLastSyncedIds(LAST_SYNCED_PHOTO_IDS_KEY, previousLocalPhotoIds)
}

async function scanPhotos() {
  await queuePhotoSync(scanPhotosNow)
}

async function scanMetadata() {
  const database = await getDatabase()
  const metadata = (await database.getAll('appMetadata')) as AppMetadataRecord[]
  const syncableMetadata = metadata.filter((record) => !isSyncInternalMetadata(record.key))
  const currentMetadataKeys = new Set(syncableMetadata.map((record) => record.key))

  for (const record of syncableMetadata) {
    const remoteUpdatedAt = cloudMetadataUpdatedAt.get(record.key)
    if (!remoteUpdatedAt || record.updatedAt > remoteUpdatedAt) {
      await setDoc(doc(firestore, METADATA_COLLECTION, record.key), record)
      cloudMetadataUpdatedAt.set(record.key, record.updatedAt)
    }
  }

  for (const key of previousLocalMetadataKeys) {
    if (currentMetadataKeys.has(key)) continue
    await deleteDoc(doc(firestore, METADATA_COLLECTION, key))
    cloudMetadataUpdatedAt.delete(key)
  }

  previousLocalMetadataKeys = currentMetadataKeys
}

async function scanLocalChanges() {
  if (!navigator.onLine) return
  if (!(await isBootstrappedLocally())) return

  const database = await getDatabase()

  await scanPassengers()
  await scanLuggage()

  await scanSimpleCollection<LuggageMovement>({
    collectionName: MOVEMENTS_COLLECTION,
    metadataKey: LAST_SYNCED_MOVEMENT_IDS_KEY,
    parse: asMovement,
    timestamp: (movement) => movement.occurredAt,
    loadLocal: () => database.getAll('movements'),
    putLocal: (movement) => database.put('movements', movement),
    deleteLocal: (movementId) => database.delete('movements', movementId),
    getPreviousIds: () => previousLocalMovementIds,
    setPreviousIds: (ids) => {
      previousLocalMovementIds = ids
    },
    cloudUpdatedAt: cloudMovementUpdatedAt,
  })

  await scanSimpleCollection<OperationClosure>({
    collectionName: OPERATION_CLOSURES_COLLECTION,
    metadataKey: LAST_SYNCED_CLOSURE_IDS_KEY,
    parse: asOperationClosure,
    timestamp: (closure) => closure.finalizedAt,
    loadLocal: () => database.getAll('operationClosures'),
    putLocal: (closure) => database.put('operationClosures', closure),
    deleteLocal: (closureId) => database.delete('operationClosures', closureId),
    getPreviousIds: () => previousLocalClosureIds,
    setPreviousIds: (ids) => {
      previousLocalClosureIds = ids
    },
    cloudUpdatedAt: cloudClosureUpdatedAt,
  })

  await scanSimpleCollection<CityTransfer>({
    collectionName: CITY_TRANSFERS_COLLECTION,
    metadataKey: LAST_SYNCED_TRANSFER_IDS_KEY,
    parse: asCityTransfer,
    timestamp: (transfer) => transfer.updatedAt,
    loadLocal: () => database.getAll('cityTransfers'),
    putLocal: (transfer) => database.put('cityTransfers', transfer),
    deleteLocal: (transferId) => database.delete('cityTransfers', transferId),
    getPreviousIds: () => previousLocalTransferIds,
    setPreviousIds: (ids) => {
      previousLocalTransferIds = ids
    },
    cloudUpdatedAt: cloudTransferUpdatedAt,
  })

  await scanImportBatches()
  await scanPhotos()
  await scanMetadata()
}

function startPassengerListener() {
  if (passengerUnsubscribe) return

  passengerUnsubscribe = onSnapshot(
    collection(firestore, PASSENGERS_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const passenger = asPassenger(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudPassengerUpdatedAt.delete(change.doc.id)
            await deletePassengerLocally(change.doc.id)
            continue
          }

          if (!passenger) continue
          cloudPassengerUpdatedAt.set(passenger.id, passenger.updatedAt)

          const local = await database.get('passengers', passenger.id)
          if (!local || passenger.updatedAt >= local.updatedAt) {
            await database.put('passengers', passenger)
          }
        }
      })().catch((error) => console.error('Falha ao aplicar passageiros da nuvem:', error))
    },
    (error) => console.error('Falha no listener de passageiros:', error),
  )
}

function startLuggageListener() {
  if (luggageUnsubscribe) return

  luggageUnsubscribe = onSnapshot(
    collection(firestore, LUGGAGE_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const item = asLuggage(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudLuggageUpdatedAt.delete(change.doc.id)
            await deleteLuggageLocally(change.doc.id)
            continue
          }

          if (!item) continue
          cloudLuggageUpdatedAt.set(item.id, item.updatedAt)

          const exactLocal = await database.get('luggage', item.id)
          if (exactLocal) {
            if (item.updatedAt >= exactLocal.updatedAt) {
              await database.put('luggage', item)
            }
            continue
          }

          const codeMatch = await database.getFromIndex(
            'luggage',
            'by-code',
            item.normalizedCode,
          )

          if (codeMatch && codeMatch.id !== item.id) {
            const canonicalLuggage =
              codeMatch.updatedAt > item.updatedAt
                ? { ...codeMatch, id: item.id }
                : item
            await renameLuggageLocally(codeMatch.id, canonicalLuggage)
            continue
          }

          await database.put('luggage', item)
        }
      })().catch((error) => console.error('Falha ao aplicar bagagens da nuvem:', error))
    },
    (error) => console.error('Falha no listener de bagagens:', error),
  )
}

function startMovementListener() {
  if (movementUnsubscribe) return

  movementUnsubscribe = onSnapshot(
    collection(firestore, MOVEMENTS_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const movement = asMovement(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudMovementUpdatedAt.delete(change.doc.id)
            await database.delete('movements', change.doc.id)
            continue
          }

          if (!movement) continue
          cloudMovementUpdatedAt.set(movement.id, movement.occurredAt)

          const local = await database.get('movements', movement.id)
          if (!local || movement.occurredAt >= local.occurredAt) {
            await database.put('movements', movement)
          }
        }
      })().catch((error) => console.error('Falha ao aplicar movimentações da nuvem:', error))
    },
    (error) => console.error('Falha no listener de movimentações:', error),
  )
}

function startClosureListener() {
  if (closureUnsubscribe) return

  closureUnsubscribe = onSnapshot(
    collection(firestore, OPERATION_CLOSURES_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const closure = asOperationClosure(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudClosureUpdatedAt.delete(change.doc.id)
            await database.delete('operationClosures', change.doc.id)
            continue
          }

          if (!closure) continue
          cloudClosureUpdatedAt.set(closure.id, closure.finalizedAt)

          const local = await database.get('operationClosures', closure.id)
          if (!local || closure.finalizedAt >= local.finalizedAt) {
            await database.put('operationClosures', closure)
          }
        }
      })().catch((error) => console.error('Falha ao aplicar fechamentos da nuvem:', error))
    },
    (error) => console.error('Falha no listener de fechamentos:', error),
  )
}

function startTransferListener() {
  if (transferUnsubscribe) return

  transferUnsubscribe = onSnapshot(
    collection(firestore, CITY_TRANSFERS_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const transfer = asCityTransfer(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudTransferUpdatedAt.delete(change.doc.id)
            await database.delete('cityTransfers', change.doc.id)
            continue
          }

          if (!transfer) continue
          cloudTransferUpdatedAt.set(transfer.id, transfer.updatedAt)

          const local = await database.get('cityTransfers', transfer.id)
          if (!local || transfer.updatedAt >= local.updatedAt) {
            await database.put('cityTransfers', transfer)
          }
        }
      })().catch((error) => console.error('Falha ao aplicar entregas municipais da nuvem:', error))
    },
    (error) => console.error('Falha no listener de entregas municipais:', error),
  )
}

function startImportBatchListener() {
  if (importBatchUnsubscribe) return

  importBatchUnsubscribe = onSnapshot(
    collection(firestore, PASSENGER_IMPORT_BATCHES_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const batch = asPassengerImportBatch(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudImportBatchUpdatedAt.delete(change.doc.id)
            await database.delete('passengerImportBatches', change.doc.id)
            continue
          }

          if (!batch) continue
          cloudImportBatchUpdatedAt.set(batch.id, batch.importedAt)

          const exactLocal = await database.get('passengerImportBatches', batch.id)
          if (exactLocal) {
            if (batch.importedAt >= exactLocal.importedAt) {
              await database.put('passengerImportBatches', batch)
            }
            continue
          }

          const fingerprintMatch = await database.getFromIndex(
            'passengerImportBatches',
            'by-fingerprint',
            batch.fingerprint,
          )

          if (fingerprintMatch && fingerprintMatch.id !== batch.id) {
            const canonicalBatch =
              fingerprintMatch.importedAt > batch.importedAt
                ? { ...fingerprintMatch, id: batch.id }
                : batch
            await renameImportBatchLocally(fingerprintMatch.id, canonicalBatch)
            continue
          }

          await database.put('passengerImportBatches', batch)
        }
      })().catch((error) =>
        console.error('Falha ao aplicar histórico de importações da nuvem:', error),
      )
    },
    (error) => console.error('Falha no listener do histórico de importações:', error),
  )
}

function startPhotoListener() {
  if (photoUnsubscribe) return

  photoUnsubscribe = onSnapshot(
    collection(firestore, PHOTO_METADATA_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void queuePhotoSync(async () => {
        const database = await getDatabase()
        let syncedIdsChanged = false

        for (const change of snapshot.docChanges()) {
          const metadata = asPhotoMetadata(change.doc.id, change.doc.data())

          if (change.type === 'removed') {
            cloudPhotoUpdatedAt.delete(change.doc.id)

            if (previousLocalPhotoIds.has(change.doc.id)) {
              await database.delete('photos', change.doc.id)
              previousLocalPhotoIds.delete(change.doc.id)
              syncedIdsChanged = true
            }
            continue
          }

          if (!metadata) continue
          cloudPhotoUpdatedAt.set(metadata.id, metadata.updatedAt)

          const local = await database.get('photos', metadata.id)

          if (!local && previousLocalPhotoIds.has(metadata.id)) {
            await deletePhotoFromCloud(metadata.id)
            cloudPhotoUpdatedAt.delete(metadata.id)
            previousLocalPhotoIds.delete(metadata.id)
            syncedIdsChanged = true
            continue
          }

          if (local && local.updatedAt > metadata.updatedAt) {
            continue
          }

          if (!local || photoNeedsCloudRefresh(local, metadata)) {
            try {
              await downloadPhotoFromCloud(metadata)
              syncedIdsChanged = true
            } catch (error) {
              console.error(`Falha ao baixar a foto ${metadata.id} da nuvem:`, error)
            }
            continue
          }

          if (!previousLocalPhotoIds.has(metadata.id)) {
            previousLocalPhotoIds.add(metadata.id)
            syncedIdsChanged = true
          }
        }

        if (syncedIdsChanged) {
          await saveLastSyncedIds(
            LAST_SYNCED_PHOTO_IDS_KEY,
            previousLocalPhotoIds,
          )
        }
      }).catch((error) =>
        console.error('Falha ao aplicar fotos da nuvem:', error),
      )
    },
    (error) => console.error('Falha no listener de fotos:', error),
  )
}

function startMetadataListener() {
  if (metadataUnsubscribe) return

  metadataUnsubscribe = onSnapshot(
    collection(firestore, METADATA_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => {
      void (async () => {
        const database = await getDatabase()

        for (const change of snapshot.docChanges()) {
          const record = asMetadata(change.doc.id, change.doc.data())
          if (!record || isSyncInternalMetadata(record.key)) continue

          if (change.type === 'removed') {
            cloudMetadataUpdatedAt.delete(record.key)
            await database.delete('appMetadata', record.key)
            continue
          }

          cloudMetadataUpdatedAt.set(record.key, record.updatedAt)
          const local = await database.get('appMetadata', record.key)

          if (!local || record.updatedAt >= local.updatedAt) {
            await database.put('appMetadata', record)
          }
        }
      })().catch((error) => console.error('Falha ao aplicar metadados da nuvem:', error))
    },
    (error) => console.error('Falha no listener de metadados:', error),
  )
}

function startRemoteListeners() {
  startPassengerListener()
  startLuggageListener()
  startMovementListener()
  startClosureListener()
  startTransferListener()
  startImportBatchListener()
  startPhotoListener()
  startMetadataListener()
}

function startLocalScanner() {
  if (localScanTimer !== null) return

  void scanLocalChanges().catch((error) =>
    console.error('Falha ao sincronizar alterações locais:', error),
  )

  localScanTimer = window.setInterval(() => {
    void scanLocalChanges().catch((error) =>
      console.error('Falha ao sincronizar alterações locais:', error),
    )
  }, LOCAL_SCAN_INTERVAL_MS)
}

async function loadPreviousIds() {
  const [
    passengerIds,
    luggageIds,
    movementIds,
    closureIds,
    transferIds,
    importBatchIds,
    photoIds,
  ] = await Promise.all([
    loadLastSyncedIds(LAST_SYNCED_PASSENGER_IDS_KEY),
    loadLastSyncedIds(LAST_SYNCED_LUGGAGE_IDS_KEY),
    loadLastSyncedIds(LAST_SYNCED_MOVEMENT_IDS_KEY),
    loadLastSyncedIds(LAST_SYNCED_CLOSURE_IDS_KEY),
    loadLastSyncedIds(LAST_SYNCED_TRANSFER_IDS_KEY),
    loadLastSyncedIds(LAST_SYNCED_IMPORT_BATCH_IDS_KEY),
    loadLastSyncedIds(LAST_SYNCED_PHOTO_IDS_KEY),
  ])

  previousLocalPassengerIds = passengerIds
  previousLocalLuggageIds = luggageIds
  previousLocalMovementIds = movementIds
  previousLocalClosureIds = closureIds
  previousLocalTransferIds = transferIds
  previousLocalImportBatchIds = importBatchIds
  previousLocalPhotoIds = photoIds
}

export async function startCloudSync() {
  if (syncStarted) return
  syncStarted = true

  if (navigator.onLine) {
    await ensureBootstrap()
  }

  if (await isBootstrappedLocally()) {
    await loadPreviousIds()
    startRemoteListeners()
    startLocalScanner()
  }

  if (!onlineListener) {
    onlineListener = () => {
      void ensureBootstrap()
        .then(async () => {
          if (!(await isBootstrappedLocally())) return
          await loadPreviousIds()
          startRemoteListeners()
          startLocalScanner()
          await scanLocalChanges()
        })
        .catch((error) => console.error('Falha ao retomar sincronização:', error))
    }

    window.addEventListener('online', onlineListener)
  }
}

export function stopCloudSync() {
  passengerUnsubscribe?.()
  luggageUnsubscribe?.()
  movementUnsubscribe?.()
  closureUnsubscribe?.()
  transferUnsubscribe?.()
  importBatchUnsubscribe?.()
  photoUnsubscribe?.()
  metadataUnsubscribe?.()

  passengerUnsubscribe = null
  luggageUnsubscribe = null
  movementUnsubscribe = null
  closureUnsubscribe = null
  transferUnsubscribe = null
  importBatchUnsubscribe = null
  photoUnsubscribe = null
  metadataUnsubscribe = null

  if (localScanTimer !== null) {
    window.clearInterval(localScanTimer)
    localScanTimer = null
  }

  if (onlineListener) {
    window.removeEventListener('online', onlineListener)
    onlineListener = null
  }

  previousLocalPassengerIds = new Set()
  previousLocalLuggageIds = new Set()
  previousLocalMovementIds = new Set()
  previousLocalClosureIds = new Set()
  previousLocalTransferIds = new Set()
  previousLocalImportBatchIds = new Set()
  previousLocalPhotoIds = new Set()
  previousLocalMetadataKeys = new Set()

  cloudPassengerUpdatedAt.clear()
  cloudLuggageUpdatedAt.clear()
  cloudMovementUpdatedAt.clear()
  cloudClosureUpdatedAt.clear()
  cloudTransferUpdatedAt.clear()
  cloudImportBatchUpdatedAt.clear()
  cloudPhotoUpdatedAt.clear()
  cloudMetadataUpdatedAt.clear()

  photoSyncTail = Promise.resolve()
  syncStarted = false
}
