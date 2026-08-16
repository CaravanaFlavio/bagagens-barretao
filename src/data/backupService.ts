import type {
  CityTransfer,
  Luggage,
  LuggageMovement,
  OperationClosure,
  Passenger,
  PassengerImportBatch,
  PhotoRecord,
  SetReconciliation,
  UnidentifiedLuggage,
} from '../domain/types'
import {
  BAGAGENS_DATABASE_VERSION,
  getDatabase,
} from './appDatabase'

const BACKUP_MAGIC = 'BAGAGENS_BARRETAO_BACKUP'
const BACKUP_FORMAT_VERSION = 1
const LAST_BACKUP_METADATA_KEY = 'last-local-backup'
const LAST_RESTORE_METADATA_KEY = 'last-local-restore'

interface AppMetadataRecord {
  key: string
  value: string
  updatedAt: string
}

interface SerializedPhotoRecord extends Omit<PhotoRecord, 'blob'> {
  blobBase64: string
  blobType: string
}

interface BackupStores {
  passengers: Passenger[]
  luggage: Luggage[]
  movements: LuggageMovement[]
  photos: SerializedPhotoRecord[]
  operationClosures: OperationClosure[]
  cityTransfers: CityTransfer[]
  appMetadata: AppMetadataRecord[]
  passengerImportBatches: PassengerImportBatch[]
  unidentifiedLuggage: UnidentifiedLuggage[]
  setReconciliations: SetReconciliation[]
}

interface BackupPayload {
  magic: typeof BACKUP_MAGIC
  formatVersion: number
  databaseVersion: number
  appName: 'Bagagens Barretão'
  createdAt: string
  stores: BackupStores
}

export interface BackupOverview {
  passengerCount: number
  luggageCount: number
  movementCount: number
  photoCount: number
  photoBytes: number
  unidentifiedCount: number
  setReconciliationCount: number
  closureCount: number
  cityTransferCount: number
  lastBackupAt?: string
  lastRestoreAt?: string
}

export interface BackupInspection extends BackupOverview {
  fileName: string
  fileSizeBytes: number
  createdAt: string
  databaseVersion: number
  formatVersion: number
  warnings: string[]
}

export interface CreatedBackup {
  file: File
  inspection: BackupInspection
}

function now() {
  return new Date().toISOString()
}

function backupFileTimestamp(value: string) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function base64FromBytes(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function bytesFromBase64(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function serializePhoto(photo: PhotoRecord): Promise<SerializedPhotoRecord> {
  const bytes = new Uint8Array(await photo.blob.arrayBuffer())
  const { blob, ...rest } = photo
  void blob
  return {
    ...rest,
    blobBase64: base64FromBytes(bytes),
    blobType: photo.blob.type || photo.mimeType || 'application/octet-stream',
  }
}

function deserializePhoto(photo: SerializedPhotoRecord): PhotoRecord {
  const {
    blobBase64,
    blobType,
    ...rest
  } = photo

  const bytes = bytesFromBase64(blobBase64)
  return {
    ...rest,
    blob: new Blob([bytes], {
      type: blobType || photo.mimeType || 'application/octet-stream',
    }),
  }
}

async function compressBackupBlob(blob: Blob) {
  if (typeof CompressionStream === 'undefined') {
    return {
      blob,
      compressed: false,
    }
  }

  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const compressedBuffer = await new Response(stream).arrayBuffer()
  return {
    blob: new Blob([compressedBuffer], { type: 'application/gzip' }),
    compressed: true,
  }
}

async function readBackupText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

  if (!isGzip) {
    return new TextDecoder().decode(bytes)
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Este backup está compactado e o navegador atual não consegue descompactá-lo. Use uma versão atual do Chrome/Android.',
    )
  }

  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream('gzip'),
  )
  return new Response(stream).text()
}

function requireArray(
  value: unknown,
  storeName: keyof BackupStores,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`O backup está incompleto: a seção “${storeName}” não foi encontrada.`)
  }
}

function validatePayload(value: unknown): BackupPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('O arquivo selecionado não é um backup válido do Bagagens Barretão.')
  }

  const payload = value as Partial<BackupPayload>

  if (payload.magic !== BACKUP_MAGIC) {
    throw new Error('O arquivo selecionado não pertence ao backup do Bagagens Barretão.')
  }

  if (payload.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Formato de backup incompatível. Este aplicativo aceita a versão ${BACKUP_FORMAT_VERSION}.`,
    )
  }

  if (
    typeof payload.databaseVersion !== 'number' ||
    payload.databaseVersion > BAGAGENS_DATABASE_VERSION
  ) {
    throw new Error(
      'Este backup foi criado por uma versão mais nova do aplicativo. Atualize o app antes de restaurar.',
    )
  }

  if (!payload.createdAt || typeof payload.createdAt !== 'string') {
    throw new Error('O backup não possui data de criação válida.')
  }

  if (!payload.stores || typeof payload.stores !== 'object') {
    throw new Error('O backup não contém as tabelas do banco de dados.')
  }

  const stores = payload.stores as Partial<BackupStores>
  const requiredStores: Array<keyof BackupStores> = [
    'passengers',
    'luggage',
    'movements',
    'photos',
    'operationClosures',
    'cityTransfers',
    'appMetadata',
    'passengerImportBatches',
    'unidentifiedLuggage',
    'setReconciliations',
  ]

  for (const storeName of requiredStores) {
    requireArray(stores[storeName], storeName)
  }

  return payload as BackupPayload
}

function validateCoreReferences(payload: BackupPayload) {
  const warnings: string[] = []
  const passengerIds = new Set(payload.stores.passengers.map((item) => item.id))
  const luggageIds = new Set(payload.stores.luggage.map((item) => item.id))
  const photoIds = new Set(payload.stores.photos.map((item) => item.id))
  const codeSet = new Set<string>()

  for (const luggage of payload.stores.luggage) {
    if (!passengerIds.has(luggage.passengerId)) {
      throw new Error(
        `O backup contém a bagagem ${luggage.code || luggage.id} sem passageiro correspondente.`,
      )
    }

    if (codeSet.has(luggage.normalizedCode)) {
      throw new Error(
        `O backup contém código de bagagem duplicado: ${luggage.code}.`,
      )
    }
    codeSet.add(luggage.normalizedCode)
  }

  for (const movement of payload.stores.movements) {
    if (!luggageIds.has(movement.luggageId)) {
      throw new Error('O backup contém movimentação ligada a uma bagagem inexistente.')
    }
  }

  for (const reconciliation of payload.stores.setReconciliations) {
    if (!passengerIds.has(reconciliation.passengerId)) {
      throw new Error('O backup contém conferência de conjunto sem passageiro correspondente.')
    }
    if (reconciliation.photoId && !photoIds.has(reconciliation.photoId)) {
      warnings.push(
        'Há uma conferência de conjunto cuja fotografia não foi localizada no backup.',
      )
    }
  }

  for (const photo of payload.stores.photos) {
    if (!photo.blobBase64) {
      throw new Error('O backup contém uma fotografia sem os dados da imagem.')
    }
    if (photo.passengerId && !passengerIds.has(photo.passengerId)) {
      warnings.push('Há fotografia histórica ligada a um passageiro que não está mais na base.')
    }
    if (photo.luggageId && !luggageIds.has(photo.luggageId)) {
      warnings.push('Há fotografia histórica ligada a uma bagagem que não está mais na base.')
    }
  }

  return Array.from(new Set(warnings))
}

function overviewFromPayload(payload: BackupPayload): BackupOverview {
  const openUnidentified = payload.stores.unidentifiedLuggage
    .filter((item) => item.status === 'OPEN')
    .reduce((total, item) => total + item.quantity, 0)

  const metadataMap = new Map(
    payload.stores.appMetadata.map((item) => [item.key, item.value]),
  )

  return {
    passengerCount: payload.stores.passengers.length,
    luggageCount: payload.stores.luggage.length,
    movementCount: payload.stores.movements.length,
    photoCount: payload.stores.photos.length,
    photoBytes: payload.stores.photos.reduce(
      (total, photo) => total + (photo.sizeBytes || 0),
      0,
    ),
    unidentifiedCount: openUnidentified,
    setReconciliationCount: payload.stores.setReconciliations.length,
    closureCount: payload.stores.operationClosures.length,
    cityTransferCount: payload.stores.cityTransfers.length,
    lastBackupAt: metadataMap.get(LAST_BACKUP_METADATA_KEY),
    lastRestoreAt: metadataMap.get(LAST_RESTORE_METADATA_KEY),
  }
}

async function buildBackupPayload(createdAt: string): Promise<BackupPayload> {
  const database = await getDatabase()
  const [
    passengers,
    luggage,
    movements,
    rawPhotos,
    operationClosures,
    cityTransfers,
    appMetadata,
    passengerImportBatches,
    unidentifiedLuggage,
    setReconciliations,
  ] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
    database.getAll('photos'),
    database.getAll('operationClosures'),
    database.getAll('cityTransfers'),
    database.getAll('appMetadata'),
    database.getAll('passengerImportBatches'),
    database.getAll('unidentifiedLuggage'),
    database.getAll('setReconciliations'),
  ])

  const photos: SerializedPhotoRecord[] = []
  for (const photo of rawPhotos) {
    photos.push(await serializePhoto(photo))
  }

  const backupMetadata: AppMetadataRecord = {
    key: LAST_BACKUP_METADATA_KEY,
    value: createdAt,
    updatedAt: createdAt,
  }

  return {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    databaseVersion: BAGAGENS_DATABASE_VERSION,
    appName: 'Bagagens Barretão',
    createdAt,
    stores: {
      passengers,
      luggage,
      movements,
      photos,
      operationClosures,
      cityTransfers,
      appMetadata: [
        ...appMetadata.filter((item) => item.key !== LAST_BACKUP_METADATA_KEY),
        backupMetadata,
      ],
      passengerImportBatches,
      unidentifiedLuggage,
      setReconciliations,
    },
  }
}

async function writeMetadata(key: string, value: string) {
  const database = await getDatabase()
  await database.put('appMetadata', {
    key,
    value,
    updatedAt: now(),
  })
}

export async function getBackupOverview(): Promise<BackupOverview> {
  const database = await getDatabase()
  const [
    passengers,
    luggage,
    movements,
    photos,
    closures,
    cityTransfers,
    appMetadata,
    unidentified,
    reconciliations,
  ] = await Promise.all([
    database.count('passengers'),
    database.count('luggage'),
    database.count('movements'),
    database.getAll('photos'),
    database.count('operationClosures'),
    database.count('cityTransfers'),
    database.getAll('appMetadata'),
    database.getAllFromIndex('unidentifiedLuggage', 'by-status', 'OPEN'),
    database.count('setReconciliations'),
  ])

  const metadataMap = new Map(appMetadata.map((item) => [item.key, item.value]))

  return {
    passengerCount: passengers,
    luggageCount: luggage,
    movementCount: movements,
    photoCount: photos.length,
    photoBytes: photos.reduce((total, photo) => total + (photo.sizeBytes || 0), 0),
    unidentifiedCount: unidentified.reduce((total, item) => total + item.quantity, 0),
    setReconciliationCount: reconciliations,
    closureCount: closures,
    cityTransferCount: cityTransfers,
    lastBackupAt: metadataMap.get(LAST_BACKUP_METADATA_KEY),
    lastRestoreAt: metadataMap.get(LAST_RESTORE_METADATA_KEY),
  }
}

export async function createBackup(): Promise<CreatedBackup> {
  const createdAt = now()
  const payload = await buildBackupPayload(createdAt)
  const rawBlob = new Blob([JSON.stringify(payload)], {
    type: 'application/json;charset=utf-8',
  })
  const packed = await compressBackupBlob(rawBlob)
  const fileName = `Bagagens_Barretao_Backup_${backupFileTimestamp(payload.createdAt)}.barretaobackup`
  const file = new File([packed.blob], fileName, {
    type: packed.compressed ? 'application/gzip' : 'application/json',
  })

  await writeMetadata(LAST_BACKUP_METADATA_KEY, payload.createdAt)

  return {
    file,
    inspection: {
      ...overviewFromPayload(payload),
      fileName,
      fileSizeBytes: file.size,
      createdAt: payload.createdAt,
      databaseVersion: payload.databaseVersion,
      formatVersion: payload.formatVersion,
      warnings: [],
    },
  }
}

export function downloadBackup(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function shareBackup(file: File) {
  if (
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function' ||
    !navigator.canShare({ files: [file] })
  ) {
    return false
  }

  await navigator.share({
    title: 'Backup Bagagens Barretão',
    text: 'Cópia completa do banco de bagagens.',
    files: [file],
  })
  return true
}

async function parseBackup(file: File) {
  const backupText = await readBackupText(file)
  const parsed: unknown = JSON.parse(backupText)

  const payload = validatePayload(parsed)
  const warnings = validateCoreReferences(payload)
  return { payload, warnings }
}

export async function inspectBackup(file: File): Promise<BackupInspection> {
  const { payload, warnings } = await parseBackup(file)
  return {
    ...overviewFromPayload(payload),
    fileName: file.name,
    fileSizeBytes: file.size,
    createdAt: payload.createdAt,
    databaseVersion: payload.databaseVersion,
    formatVersion: payload.formatVersion,
    warnings,
  }
}

export async function restoreBackup(file: File): Promise<BackupInspection> {
  const { payload, warnings } = await parseBackup(file)

  const photos: PhotoRecord[] = []
  for (const photo of payload.stores.photos) {
    photos.push(deserializePhoto(photo))
  }

  const database = await getDatabase()
  const transaction = database.transaction(
    [
      'passengers',
      'luggage',
      'movements',
      'photos',
      'operationClosures',
      'cityTransfers',
      'appMetadata',
      'passengerImportBatches',
      'unidentifiedLuggage',
      'setReconciliations',
    ],
    'readwrite',
  )

  await transaction.objectStore('passengers').clear()
  await transaction.objectStore('luggage').clear()
  await transaction.objectStore('movements').clear()
  await transaction.objectStore('photos').clear()
  await transaction.objectStore('operationClosures').clear()
  await transaction.objectStore('cityTransfers').clear()
  await transaction.objectStore('appMetadata').clear()
  await transaction.objectStore('passengerImportBatches').clear()
  await transaction.objectStore('unidentifiedLuggage').clear()
  await transaction.objectStore('setReconciliations').clear()

  for (const item of payload.stores.passengers) {
    await transaction.objectStore('passengers').put(item)
  }
  for (const item of payload.stores.luggage) {
    await transaction.objectStore('luggage').put(item)
  }
  for (const item of payload.stores.movements) {
    await transaction.objectStore('movements').put(item)
  }
  for (const item of photos) {
    await transaction.objectStore('photos').put(item)
  }
  for (const item of payload.stores.operationClosures) {
    await transaction.objectStore('operationClosures').put(item)
  }
  for (const item of payload.stores.cityTransfers) {
    await transaction.objectStore('cityTransfers').put(item)
  }
  for (const item of payload.stores.appMetadata) {
    await transaction.objectStore('appMetadata').put(item)
  }
  for (const item of payload.stores.passengerImportBatches) {
    await transaction.objectStore('passengerImportBatches').put(item)
  }
  for (const item of payload.stores.unidentifiedLuggage) {
    await transaction.objectStore('unidentifiedLuggage').put(item)
  }
  for (const item of payload.stores.setReconciliations) {
    await transaction.objectStore('setReconciliations').put(item)
  }

  const restoredAt = now()
  await transaction.objectStore('appMetadata').put({
    key: LAST_RESTORE_METADATA_KEY,
    value: restoredAt,
    updatedAt: restoredAt,
  })

  await transaction.done

  return {
    ...overviewFromPayload(payload),
    lastRestoreAt: restoredAt,
    fileName: file.name,
    fileSizeBytes: file.size,
    createdAt: payload.createdAt,
    databaseVersion: payload.databaseVersion,
    formatVersion: payload.formatVersion,
    warnings,
  }
}
