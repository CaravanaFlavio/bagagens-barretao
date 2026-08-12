import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  onSnapshot,
  setDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import type { Passenger } from '../domain/types'
import { getDatabase } from './appDatabase'
import { firestore } from './firebaseConfig'

const PASSENGERS_COLLECTION = 'passengers'
const METADATA_COLLECTION = 'appMetadata'
const BOOTSTRAP_METADATA_KEY = 'cloud-sync-bootstrap-v1'
const LAST_SYNCED_PASSENGER_IDS_KEY = 'cloud-sync-last-passenger-ids-v1'
const LOCAL_SCAN_INTERVAL_MS = 1500
const FIRESTORE_BATCH_LIMIT = 450

interface AppMetadataRecord {
  key: string
  value: string
  updatedAt: string
}

export interface CloudInspection {
  online: boolean
  localPassengerCount: number
  cloudPassengerCount: number | null
  bootstrapped: boolean
}

let passengerUnsubscribe: Unsubscribe | null = null
let metadataUnsubscribe: Unsubscribe | null = null
let localScanTimer: number | null = null
let onlineListener: (() => void) | null = null
let syncStarted = false
let bootstrapInFlight: Promise<void> | null = null
let previousLocalPassengerIds = new Set<string>()
let previousLocalMetadataKeys = new Set<string>()
const cloudPassengerUpdatedAt = new Map<string, string>()
const cloudMetadataUpdatedAt = new Map<string, string>()

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

async function loadLastSyncedPassengerIds() {
  const database = await getDatabase()
  const record = await database.get('appMetadata', LAST_SYNCED_PASSENGER_IDS_KEY)
  if (!record?.value) return new Set<string>()
  try {
    const parsed = JSON.parse(record.value) as unknown
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set<string>()
  }
}

async function saveLastSyncedPassengerIds(ids: Iterable<string>) {
  const database = await getDatabase()
  const timestamp = now()
  await database.put('appMetadata', {
    key: LAST_SYNCED_PASSENGER_IDS_KEY,
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
      passengerIdsWithoutLuggage: closure.passengerIdsWithoutLuggage.map((id) =>
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
  const luggageIds = new Set(passengerLuggage.map((item) => item.id))

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
        (id) => id !== passengerId,
      ),
    })
  }

  await passengerStore.delete(passengerId)
  await transaction.done
}

async function commitPassengers(passengers: Passenger[]) {
  for (let index = 0; index < passengers.length; index += FIRESTORE_BATCH_LIMIT) {
    const chunk = passengers.slice(index, index + FIRESTORE_BATCH_LIMIT)
    const batch = writeBatch(firestore)
    for (const passenger of chunk) {
      batch.set(doc(firestore, PASSENGERS_COLLECTION, passenger.id), passenger)
    }
    await batch.commit()
  }
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
  const [passengers, metadata] = await Promise.all([
    database.getAll('passengers') as Promise<Passenger[]>,
    database.getAll('appMetadata') as Promise<AppMetadataRecord[]>,
  ])

  if (passengers.length === 0) {
    throw new Error('Este dispositivo não possui passageiros para enviar à nuvem.')
  }

  await commitPassengers(passengers)
  await commitMetadata(metadata)
  await saveLastSyncedPassengerIds(passengers.map((passenger) => passenger.id))
  await markBootstrappedLocally()
  return passengers.length
}

async function reconcilePassengersFromServer() {
  const remoteSnapshot = await getDocsFromServer(collection(firestore, PASSENGERS_COLLECTION))
  const remotePassengers = (remoteSnapshot.docs as Array<{ id: string; data(): DocumentData }>)
    .map((snapshot) => asPassenger(snapshot.id, snapshot.data()))
    .filter((passenger: Passenger | null): passenger is Passenger => Boolean(passenger))

  const database = await getDatabase()
  let localPassengers = (await database.getAll('passengers')) as Passenger[]
  const lastSyncedIds = await loadLastSyncedPassengerIds()
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

  localPassengers = (await database.getAll('passengers')) as Passenger[]
  for (const localPassenger of [...localPassengers]) {
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

  localPassengers = (await database.getAll('passengers')) as Passenger[]
  previousLocalPassengerIds = new Set(localPassengers.map((passenger) => passenger.id))
  await saveLastSyncedPassengerIds(previousLocalPassengerIds)
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

  previousLocalMetadataKeys = new Set(
    localMetadata
      .filter((record) => !isSyncInternalMetadata(record.key))
      .map((record) => record.key),
  )
}

async function ensureBootstrap() {
  if (bootstrapInFlight) return bootstrapInFlight

  bootstrapInFlight = (async () => {
    if (!navigator.onLine) return
    const remoteSnapshot = await getDocsFromServer(collection(firestore, PASSENGERS_COLLECTION))
    if (remoteSnapshot.empty) return
    await reconcilePassengersFromServer()
    await reconcileMetadataFromServer()
    await markBootstrappedLocally()
  })().finally(() => {
    bootstrapInFlight = null
  })

  return bootstrapInFlight
}

async function scanLocalChanges() {
  if (!navigator.onLine) return
  if (!(await isBootstrappedLocally())) return
  const database = await getDatabase()
  const [passengers, metadata] = await Promise.all([
    database.getAll('passengers') as Promise<Passenger[]>,
    database.getAll('appMetadata') as Promise<AppMetadataRecord[]>,
  ])

  if (previousLocalPassengerIds.size === 0) {
    previousLocalPassengerIds = await loadLastSyncedPassengerIds()
  }

  const currentPassengerIds = new Set(passengers.map((passenger) => passenger.id))
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
  await saveLastSyncedPassengerIds(previousLocalPassengerIds)

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

function startRemoteListeners() {
  if (!passengerUnsubscribe) {
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

  if (!metadataUnsubscribe) {
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

export async function startCloudSync() {
  if (syncStarted) return
  syncStarted = true

  if (navigator.onLine) {
    await ensureBootstrap()
  }

  if (await isBootstrappedLocally()) {
    previousLocalPassengerIds = await loadLastSyncedPassengerIds()
    startRemoteListeners()
    startLocalScanner()
  }

  if (!onlineListener) {
    onlineListener = () => {
      void ensureBootstrap()
        .then(async () => {
          if (!(await isBootstrappedLocally())) return
          previousLocalPassengerIds = await loadLastSyncedPassengerIds()
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
  passengerUnsubscribe = null
  metadataUnsubscribe?.()
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
  previousLocalMetadataKeys = new Set()
  cloudPassengerUpdatedAt.clear()
  cloudMetadataUpdatedAt.clear()
  syncStarted = false
}
