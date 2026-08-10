import { CITIES } from '../constants/cities'
import { OPERATION_DEFINITIONS, STAGE_LABELS } from '../constants/operations'
import { getDatabase } from './appDatabase'
import {
  PASSENGER_IMPORT_2026,
  PASSENGER_IMPORT_2026_REVIEW_TOTAL,
  PASSENGER_IMPORT_2026_TOTAL,
} from './passengerImport2026'
import type {
  CentralPendency,
  ContingencySnapshot,
  CityDeliveryOverview,
  CityReportSummary,
  CityTransfer,
  CityTransferDetailsInput,
  CityTransferReceipt,
  CityTransferScanCheck,
  CityTransferWorkspace,
  DashboardSummary,
  Luggage,
  LuggageInput,
  LuggageMovement,
  LuggageReportItem,
  Passenger,
  PassengerInput,
  PassengerImport2026Result,
  PassengerImport2026Status,
  PassengerImportBatch,
  PassengerPdfImportRow,
  PassengerUpdateApplyResult,
  PassengerUpdateChange,
  PassengerUpdatePreview,
  PassengerUpdatePreviewItem,
  PassengerSummary,
  PhotoInput,
  PhotoRecord,
  OperationClosure,
  OperationKey,
  OperationLuggageItem,
  OperationPassengerGroup,
  OperationScanCheck,
  OperationSnapshot,
  PendenciesReport,
  PeriodReportSummary,
} from '../domain/types'

function now() {
  return new Date().toISOString()
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleUpperCase('pt-BR')
}

function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, '').toLocaleUpperCase('pt-BR')
}

function withPhotoIds(movement: LuggageMovement, photoIds: string[]) {
  return {
    ...movement,
    photoIds: Array.from(new Set(photoIds)),
  }
}

function withPassengerDefaults(passenger: Passenger): Passenger {
  return {
    ...passenger,
    documentNumber: passenger.documentNumber ?? '',
    documentType: passenger.documentType ?? 'UNKNOWN',
    busType: passenger.busType ?? 'UNSPECIFIED',
    reviewStatus: passenger.reviewStatus ?? 'CONFIRMED',
    importWarning: passenger.importWarning ?? '',
  }
}

const PASSENGER_IMPORT_2026_METADATA_KEY = 'passenger-import-2026-v1'

export async function listPassengers(): Promise<PassengerSummary[]> {
  const database = await getDatabase()
  const [passengers, luggage] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
  ])

  const counts = new Map<string, number>()
  const stageCounts = new Map<string, Record<Luggage['currentStage'], number>>()

  const emptyStageCounts = (): Record<Luggage['currentStage'], number> => ({
    WAREHOUSE_INITIAL: 0,
    TRAILER_OUTBOUND: 0,
    WITH_PASSENGER: 0,
    TRAILER_RETURN: 0,
    WAREHOUSE_RETURN: 0,
    DELIVERED_TO_CITY: 0,
  })

  for (const item of luggage) {
    counts.set(item.passengerId, (counts.get(item.passengerId) ?? 0) + 1)
    const passengerStageCounts = stageCounts.get(item.passengerId) ?? emptyStageCounts()
    passengerStageCounts[item.currentStage] += 1
    stageCounts.set(item.passengerId, passengerStageCounts)
  }

  return passengers
    .map((storedPassenger) => {
      const passenger = withPassengerDefaults(storedPassenger)
      return {
        ...passenger,
        luggageCount: counts.get(passenger.id) ?? 0,
        luggageStageCounts: stageCounts.get(passenger.id) ?? emptyStageCounts(),
      }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'))
}

export async function savePassenger(
  input: PassengerInput,
  passengerId?: string,
): Promise<Passenger> {
  const database = await getDatabase()
  const timestamp = now()
  const existing = passengerId
    ? await database.get('passengers', passengerId)
    : undefined

  const previous = existing ? withPassengerDefaults(existing) : undefined
  const resolvingReview =
    previous?.reviewStatus === 'REVIEW' && input.reviewStatus === 'CONFIRMED'

  const passenger: Passenger = {
    id: previous?.id ?? newId('passenger'),
    fullName: input.fullName.trim(),
    normalizedName: normalizeText(input.fullName),
    city: input.city,
    phone: input.phone.trim(),
    travelPeriod: input.travelPeriod,
    documentNumber: input.documentNumber.trim(),
    documentType: input.documentType,
    busType: input.busType,
    reviewStatus: input.reviewStatus,
    importWarning: previous?.importWarning ?? '',
    reviewResolvedAt: resolvingReview
      ? timestamp
      : input.reviewStatus === 'REVIEW'
        ? undefined
        : previous?.reviewResolvedAt,
    importSourceKey: previous?.importSourceKey,
    importSourceFile: previous?.importSourceFile,
    importSourcePage: previous?.importSourcePage,
    sourceRole: previous?.sourceRole,
    importedAt: previous?.importedAt,
    lastUpdateSourceFile: previous?.lastUpdateSourceFile,
    lastUpdateSourcePage: previous?.lastUpdateSourcePage,
    lastUpdatedFromImportAt: previous?.lastUpdatedFromImportAt,
    notes: input.notes.trim(),
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  await database.put('passengers', passenger)
  return passenger
}

export async function deletePassengerPermanently(passengerId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['passengers', 'luggage', 'movements', 'photos', 'cityTransfers'],
    'readwrite',
  )

  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const transferStore = transaction.objectStore('cityTransfers')
  const passengerLuggage = await luggageStore.index('by-passenger').getAll(passengerId)
  const passengerPhotoKeys = await photoStore.index('by-passenger').getAllKeys(passengerId)
  const luggageIds = new Set(passengerLuggage.map((item) => item.id))

  for (const luggage of passengerLuggage) {
    const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggage.id)
    await Promise.all(movementKeys.map((movementId) => movementStore.delete(movementId)))
    await luggageStore.delete(luggage.id)
  }

  const transfers = await transferStore.getAll()
  for (const transfer of transfers) {
    const removeIds = (ids: string[]) => ids.filter((id) => !luggageIds.has(id))
    const updated: CityTransfer = {
      ...transfer,
      scannedLuggageIds: removeIds(transfer.scannedLuggageIds),
      expectedLuggageIds: removeIds(transfer.expectedLuggageIds),
      missingLuggageIds: removeIds(transfer.missingLuggageIds),
      updatedAt: now(),
    }
    await transferStore.put(updated)
  }

  await Promise.all(passengerPhotoKeys.map((photoId) => photoStore.delete(photoId)))
  await transaction.objectStore('passengers').delete(passengerId)
  await transaction.done
}

export async function listLuggageByPassenger(passengerId: string): Promise<Luggage[]> {
  const database = await getDatabase()
  const luggage = await database.getAllFromIndex('luggage', 'by-passenger', passengerId)
  return luggage.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function createLuggage(input: LuggageInput): Promise<Luggage> {
  const database = await getDatabase()
  const normalizedCode = normalizeCode(input.code)

  if (!normalizedCode) {
    throw new Error('Informe ou escaneie o código da bagagem.')
  }

  const existing = await database.getFromIndex('luggage', 'by-code', normalizedCode)
  if (existing) {
    throw new Error(`O código ${existing.code} já está vinculado a outra bagagem.`)
  }

  const passengerPhotos = await database.getAllFromIndex('photos', 'by-passenger', input.passengerId)
  const setPhoto = passengerPhotos.find((photo) => photo.kind === 'PASSENGER_SET')

  const timestamp = now()
  const luggage: Luggage = {
    id: newId('luggage'),
    passengerId: input.passengerId,
    code: input.code.trim(),
    normalizedCode,
    codeSource: input.codeSource,
    labelColor: input.labelColor.trim(),
    luggageType: input.luggageType.trim(),
    notes: input.notes.trim(),
    currentStage: 'WAREHOUSE_INITIAL',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const movement: LuggageMovement = {
    id: newId('movement'),
    luggageId: luggage.id,
    type: 'REGISTERED_AT_WAREHOUSE',
    fromStage: null,
    toStage: 'WAREHOUSE_INITIAL',
    occurredAt: timestamp,
    note: 'Bagagem cadastrada e recebida no galpão.',
    photoIds: setPhoto ? [setPhoto.id] : [],
  }

  const transaction = database.transaction(['luggage', 'movements'], 'readwrite')
  await transaction.objectStore('luggage').add(luggage)
  await transaction.objectStore('movements').add(movement)
  await transaction.done

  return luggage
}

export async function deleteLuggagePermanently(luggageId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['luggage', 'movements', 'photos', 'cityTransfers'],
    'readwrite',
  )
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const transferStore = transaction.objectStore('cityTransfers')
  const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggageId)
  const photoKeys = await photoStore.index('by-luggage').getAllKeys(luggageId)

  await Promise.all(movementKeys.map((movementId) => movementStore.delete(movementId)))
  await Promise.all(photoKeys.map((photoId) => photoStore.delete(photoId)))

  const transfers = await transferStore.getAll()
  for (const transfer of transfers) {
    const removeId = (ids: string[]) => ids.filter((id) => id !== luggageId)
    await transferStore.put({
      ...transfer,
      scannedLuggageIds: removeId(transfer.scannedLuggageIds),
      expectedLuggageIds: removeId(transfer.expectedLuggageIds),
      missingLuggageIds: removeId(transfer.missingLuggageIds),
      updatedAt: now(),
    })
  }

  await transaction.objectStore('luggage').delete(luggageId)
  await transaction.done
}

export async function listLuggageMovements(luggageId: string): Promise<LuggageMovement[]> {
  const database = await getDatabase()
  const movements = await database.getAllFromIndex('movements', 'by-luggage', luggageId)
  return movements.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}

export async function getPassengerSetPhoto(passengerId: string): Promise<PhotoRecord | undefined> {
  const database = await getDatabase()
  const photos = await database.getAllFromIndex('photos', 'by-passenger', passengerId)
  return photos.find((photo) => photo.kind === 'PASSENGER_SET')
}

export async function listLuggagePhotosByPassenger(passengerId: string): Promise<PhotoRecord[]> {
  const database = await getDatabase()
  const photos = await database.getAllFromIndex('photos', 'by-passenger', passengerId)
  return photos.filter((photo) => photo.kind === 'LUGGAGE_DETAIL')
}

export async function getPhotosByIds(photoIds: string[]): Promise<PhotoRecord[]> {
  if (photoIds.length === 0) return []
  const database = await getDatabase()
  const photos = await Promise.all(photoIds.map((photoId) => database.get('photos', photoId)))
  return photos.filter((photo): photo is PhotoRecord => Boolean(photo))
}

export async function savePassengerSetPhoto(
  passengerId: string,
  input: PhotoInput,
): Promise<PhotoRecord> {
  const database = await getDatabase()
  const timestamp = now()
  const transaction = database.transaction(['photos', 'luggage', 'movements'], 'readwrite')
  const photoStore = transaction.objectStore('photos')
  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')

  const passengerPhotos = await photoStore.index('by-passenger').getAll(passengerId)
  const previousPhotos = passengerPhotos.filter((photo) => photo.kind === 'PASSENGER_SET')
  const previousPhotoIds = previousPhotos.map((photo) => photo.id)

  const photo: PhotoRecord = {
    id: newId('photo'),
    kind: 'PASSENGER_SET',
    passengerId,
    luggageId: '',
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const passengerLuggage = await luggageStore.index('by-passenger').getAll(passengerId)
  for (const item of passengerLuggage) {
    const movements = await movementStore.index('by-luggage').getAll(item.id)
    const initial = movements.find((movement) => movement.type === 'REGISTERED_AT_WAREHOUSE')
    if (!initial) continue

    const retainedPhotoIds = (initial.photoIds ?? []).filter(
      (photoId) => !previousPhotoIds.includes(photoId),
    )
    await movementStore.put(withPhotoIds(initial, [...retainedPhotoIds, photo.id]))
  }

  await Promise.all(previousPhotoIds.map((photoId) => photoStore.delete(photoId)))
  await photoStore.add(photo)
  await transaction.done
  return photo
}

export async function saveLuggagePhoto(
  passengerId: string,
  luggageId: string,
  input: PhotoInput,
): Promise<PhotoRecord> {
  const database = await getDatabase()
  const timestamp = now()
  const transaction = database.transaction(['photos', 'movements'], 'readwrite')
  const photoStore = transaction.objectStore('photos')
  const movementStore = transaction.objectStore('movements')

  const luggagePhotos = await photoStore.index('by-luggage').getAll(luggageId)
  const previousPhotos = luggagePhotos.filter((photo) => photo.kind === 'LUGGAGE_DETAIL')
  const previousPhotoIds = previousPhotos.map((photo) => photo.id)

  const photo: PhotoRecord = {
    id: newId('photo'),
    kind: 'LUGGAGE_DETAIL',
    passengerId,
    luggageId,
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const movements = await movementStore.index('by-luggage').getAll(luggageId)
  const initial = movements.find((movement) => movement.type === 'REGISTERED_AT_WAREHOUSE')
  if (initial) {
    const retainedPhotoIds = (initial.photoIds ?? []).filter(
      (photoId) => !previousPhotoIds.includes(photoId),
    )
    await movementStore.put(withPhotoIds(initial, [...retainedPhotoIds, photo.id]))
  }

  await Promise.all(previousPhotoIds.map((photoId) => photoStore.delete(photoId)))
  await photoStore.add(photo)
  await transaction.done
  return photo
}

export async function deletePhoto(photoId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(['photos', 'movements'], 'readwrite')
  const movementStore = transaction.objectStore('movements')
  const movements = await movementStore.getAll()

  for (const movement of movements) {
    if (!(movement.photoIds ?? []).includes(photoId)) continue
    await movementStore.put({
      ...movement,
      photoIds: (movement.photoIds ?? []).filter((id) => id !== photoId),
    })
  }

  await transaction.objectStore('photos').delete(photoId)
  await transaction.done
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [report, passengers] = await Promise.all([
    getPendenciesReport(),
    listPassengers(),
  ])
  return {
    passengerCount: report.passengerCount,
    luggageCount: report.luggageCount,
    pendingCount: report.activePendencyCount,
    passengerReviewCount: passengers.filter(
      (passenger) => passenger.reviewStatus === 'REVIEW',
    ).length,
  }
}

export async function getPassengerImport2026Status(): Promise<PassengerImport2026Status> {
  const database = await getDatabase()
  const metadata = await database.get('appMetadata', PASSENGER_IMPORT_2026_METADATA_KEY)
  return {
    sourceTotal: PASSENGER_IMPORT_2026_TOTAL,
    sourceReviewTotal: PASSENGER_IMPORT_2026_REVIEW_TOTAL,
    completed: Boolean(metadata),
    completedAt: metadata?.value || undefined,
  }
}

export async function importPassengers2026(): Promise<PassengerImport2026Result> {
  const database = await getDatabase()
  const transaction = database.transaction(['passengers', 'appMetadata'], 'readwrite')
  const passengerStore = transaction.objectStore('passengers')
  const metadataStore = transaction.objectStore('appMetadata')
  const alreadyCompleted = await metadataStore.get(PASSENGER_IMPORT_2026_METADATA_KEY)

  if (alreadyCompleted) {
    await transaction.done
    return {
      insertedCount: 0,
      reviewCount: PASSENGER_IMPORT_2026_REVIEW_TOTAL,
      completedAt: alreadyCompleted.value,
      alreadyCompleted: true,
    }
  }

  const timestamp = now()
  for (const row of PASSENGER_IMPORT_2026) {
    const passenger: Passenger = {
      id: newId('passenger'),
      fullName: row.fullName,
      normalizedName: normalizeText(row.fullName),
      city: row.city,
      phone: '',
      travelPeriod: row.travelPeriod,
      documentNumber: row.documentNumber,
      documentType: row.documentType,
      busType: row.busType,
      reviewStatus: row.reviewStatus,
      importWarning: row.importWarning,
      importSourceKey: row.sourceKey,
      importSourceFile: row.sourceFile,
      importSourcePage: row.sourcePage,
      sourceRole: row.sourceRole,
      importedAt: timestamp,
      notes: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await passengerStore.add(passenger)
  }

  await metadataStore.put({
    key: PASSENGER_IMPORT_2026_METADATA_KEY,
    value: timestamp,
    updatedAt: timestamp,
  })
  await transaction.done

  return {
    insertedCount: PASSENGER_IMPORT_2026_TOTAL,
    reviewCount: PASSENGER_IMPORT_2026_REVIEW_TOTAL,
    completedAt: timestamp,
    alreadyCompleted: false,
  }
}


function normalizePassengerDocument(value: string) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '')
}

function updateChange(
  field: PassengerUpdateChange['field'],
  label: string,
  previousValue: string,
  nextValue: string,
): PassengerUpdateChange {
  return { field, label, previousValue, nextValue }
}

function busLabel(value: Passenger['busType']) {
  if (value === 'DOUBLE_DECKER') return 'Ônibus 2 andares'
  if (value === 'CONVENTIONAL') return 'Ônibus convencional'
  return 'Não informado'
}

function documentTypeLabel(value: Passenger['documentType']) {
  if (value === 'CPF') return 'CPF'
  if (value === 'RG') return 'RG'
  return 'Não identificado'
}

function periodLabel(value: Passenger['travelPeriod'] | '') {
  if (value === 'FIRST_WEEK') return 'Primeira semana'
  if (value === 'SECOND_WEEK') return 'Segunda semana'
  if (value === 'BOTH_WEEKS') return 'Duas semanas'
  return 'Não identificado'
}

function roleLabel(value: Passenger['sourceRole'] | PassengerPdfImportRow['sourceRole']) {
  return value === 'GUIDE' ? 'Guia' : 'Passageiro'
}

function reviewStatusLabel(value: Passenger['reviewStatus']) {
  return value === 'REVIEW' ? 'Revisar' : 'Confirmado'
}

function appendImportWarning(current: string, warning: string) {
  const clean = warning.trim()
  if (!clean) return current
  if (!current) return clean
  if (current.includes(clean)) return current
  return `${current} ${clean}`
}

function importRowLocation(row: PassengerPdfImportRow) {
  return row.sourcePage ? `${row.sourceFile}, pág. ${row.sourcePage}` : row.sourceFile
}

function candidateSpecificityScore(passenger: Passenger, row: PassengerPdfImportRow) {
  let score = 0
  if (row.city && passenger.city === row.city) score += 4
  if (row.travelPeriod && passenger.travelPeriod === row.travelPeriod) score += 3
  if (row.busType !== 'UNSPECIFIED' && passenger.busType === row.busType) score += 2
  if (passenger.sourceRole === row.sourceRole) score += 1
  return score
}

function disambiguateCandidates(candidates: Passenger[], row: PassengerPdfImportRow) {
  if (candidates.length <= 1) return candidates
  const scored = candidates.map((passenger) => ({
    passenger,
    score: candidateSpecificityScore(passenger, row),
  }))
  const bestScore = Math.max(...scored.map((item) => item.score))
  if (bestScore <= 0) return candidates
  return scored.filter((item) => item.score === bestScore).map((item) => item.passenger)
}

function calculatePassengerChanges(passenger: Passenger, row: PassengerPdfImportRow) {
  const changes: PassengerUpdateChange[] = []
  if (passenger.fullName.trim() !== row.fullName.trim()) {
    changes.push(updateChange('fullName', 'Nome', passenger.fullName, row.fullName))
  }

  const currentDocument = normalizePassengerDocument(passenger.documentNumber)
  const nextDocument = normalizePassengerDocument(row.documentNumber)
  if (nextDocument && currentDocument !== nextDocument) {
    changes.push(
      updateChange('documentNumber', 'Documento', passenger.documentNumber || 'Não informado', row.documentNumber),
    )
  }
  if (row.documentNumber && passenger.documentType !== row.documentType) {
    changes.push(
      updateChange(
        'documentType',
        'Tipo de documento',
        documentTypeLabel(passenger.documentType),
        documentTypeLabel(row.documentType),
      ),
    )
  }
  if (row.city && passenger.city !== row.city) {
    changes.push(updateChange('city', 'Cidade', passenger.city, row.city))
  }
  if (row.travelPeriod && passenger.travelPeriod !== row.travelPeriod) {
    changes.push(
      updateChange(
        'travelPeriod',
        'Período',
        periodLabel(passenger.travelPeriod),
        periodLabel(row.travelPeriod),
      ),
    )
  }
  if (row.busType !== 'UNSPECIFIED' && passenger.busType !== row.busType) {
    changes.push(
      updateChange('busType', 'Ônibus', busLabel(passenger.busType), busLabel(row.busType)),
    )
  }
  if ((passenger.sourceRole ?? 'PASSENGER') !== row.sourceRole) {
    changes.push(
      updateChange(
        'sourceRole',
        'Função',
        roleLabel(passenger.sourceRole ?? 'PASSENGER'),
        roleLabel(row.sourceRole),
      ),
    )
  }
  if (row.phone !== undefined && passenger.phone.trim() !== row.phone.trim()) {
    changes.push(
      updateChange('phone', 'Telefone', passenger.phone || 'Não informado', row.phone || 'Não informado'),
    )
  }
  if (row.reviewStatus !== undefined && passenger.reviewStatus !== row.reviewStatus) {
    changes.push(
      updateChange(
        'reviewStatus',
        'Situação do cadastro',
        reviewStatusLabel(passenger.reviewStatus),
        reviewStatusLabel(row.reviewStatus),
      ),
    )
  }
  if (row.notes !== undefined && passenger.notes.trim() !== row.notes.trim()) {
    changes.push(
      updateChange('notes', 'Observação', passenger.notes || 'Sem observação', row.notes || 'Sem observação'),
    )
  }
  return changes
}

function structuralRowProblem(row: PassengerPdfImportRow) {
  if (!row.fullName.trim()) return 'Nome não identificado no arquivo.'
  if (!row.city) return 'Cidade não identificada no arquivo.'
  if (!(CITIES as readonly string[]).includes(row.city)) {
    return `A cidade “${row.city}” não existe na lista atual do aplicativo.`
  }
  if (!row.travelPeriod) return 'Período não identificado no arquivo.'
  return ''
}

function passengerWasEditedManually(passenger: Passenger) {
  if (!passenger.importedAt) return true
  const lastImportTimestamp = passenger.lastUpdatedFromImportAt ?? passenger.importedAt
  return passenger.updatedAt > lastImportTimestamp
}

export async function previewPassengerPdfUpdate(
  rows: PassengerPdfImportRow[],
  fingerprint: string,
  fileNames: string[],
): Promise<PassengerUpdatePreview> {
  const database = await getDatabase()
  const [storedPassengers, importedBatch] = await Promise.all([
    database.getAll('passengers'),
    database.getFromIndex('passengerImportBatches', 'by-fingerprint', fingerprint),
  ])
  const passengers = storedPassengers.map(withPassengerDefaults)
  const items: PassengerUpdatePreviewItem[] = []
  const spreadsheetIdCounts = new Map<string, number>()
  for (const row of rows) {
    if (!row.passengerId) continue
    spreadsheetIdCounts.set(row.passengerId, (spreadsheetIdCounts.get(row.passengerId) ?? 0) + 1)
  }

  for (const row of rows) {
    const structuralProblem = structuralRowProblem(row)
    if (structuralProblem) {
      items.push({
        id: row.rowKey,
        row,
        status: 'CONFLICT',
        candidatePassengerIds: [],
        changes: [],
        message: structuralProblem,
      })
      continue
    }

    if (row.passengerId && (spreadsheetIdCounts.get(row.passengerId) ?? 0) > 1) {
      items.push({
        id: row.rowKey,
        row,
        status: 'CONFLICT',
        candidatePassengerIds: [row.passengerId],
        changes: [],
        message: 'O mesmo identificador interno aparece em mais de uma linha da planilha. Isso pode acontecer quando uma linha existente é copiada para criar outra pessoa. Corrija a planilha antes de importar.',
      })
      continue
    }

    if (row.passengerId) {
      const exactPassenger = passengers.find((passenger) => passenger.id === row.passengerId)
      if (!exactPassenger) {
        items.push({
          id: row.rowKey,
          row,
          status: 'CONFLICT',
          candidatePassengerIds: [],
          changes: [],
          message: 'O identificador interno desta linha não existe mais no aplicativo. Nenhum cadastro será alterado automaticamente.',
        })
        continue
      }

      const changes = calculatePassengerChanges(exactPassenger, row)
      const needsWarningUpdate = Boolean(
        row.parseWarning && !exactPassenger.importWarning.includes(row.parseWarning),
      )
      const hasUpdate = changes.length > 0 || needsWarningUpdate
      items.push({
        id: row.rowKey,
        row,
        status: hasUpdate ? 'CHANGED' : 'UNCHANGED',
        matchedPassengerId: exactPassenger.id,
        candidatePassengerIds: [exactPassenger.id],
        changes,
        message: changes.length > 0
          ? `${changes.length} ${changes.length === 1 ? 'informação será atualizada' : 'informações serão atualizadas'} a partir da planilha exportada pelo aplicativo.`
          : needsWarningUpdate
            ? 'A planilha contém uma informação que precisa ser confirmada. O cadastro será encaminhado para revisão.'
            : 'Cadastro já está igual à planilha.',
      })
      continue
    }

    const rowName = normalizeText(row.fullName)
    const rowDocument = normalizePassengerDocument(row.documentNumber)
    const sameName = passengers.filter((passenger) => passenger.normalizedName === rowName)
    const sameDocument = rowDocument
      ? passengers.filter(
          (passenger) => normalizePassengerDocument(passenger.documentNumber) === rowDocument,
        )
      : []
    const sameNameAndDocument = rowDocument
      ? sameName.filter(
          (passenger) => normalizePassengerDocument(passenger.documentNumber) === rowDocument,
        )
      : []

    let candidates: Passenger[] = []
    if (sameNameAndDocument.length > 0) {
      candidates = disambiguateCandidates(sameNameAndDocument, row)
    } else if (sameName.length > 0 && sameDocument.length > 0) {
      const conflictingCandidates = Array.from(
        new Map([...sameName, ...sameDocument].map((passenger) => [passenger.id, passenger])).values(),
      )
      items.push({
        id: row.rowKey,
        row,
        status: 'CONFLICT',
        candidatePassengerIds: conflictingCandidates.map((candidate) => candidate.id),
        changes: [],
        message: 'O nome aponta para um cadastro e o documento aponta para outro. Nenhum deles será alterado automaticamente.',
      })
      continue
    } else if (sameName.length > 0) {
      candidates = disambiguateCandidates(sameName, row)
    } else if (sameDocument.length > 0) {
      candidates = disambiguateCandidates(sameDocument, row)
    }

    if (candidates.length > 1) {
      items.push({
        id: row.rowKey,
        row,
        status: 'CONFLICT',
        candidatePassengerIds: candidates.map((candidate) => candidate.id),
        changes: [],
        message: 'Há mais de um cadastro possível para esta linha. Nenhum dado será substituído automaticamente.',
      })
      continue
    }

    const matched = candidates[0]
    if (!matched) {
      items.push({
        id: row.rowKey,
        row,
        status: 'NEW',
        candidatePassengerIds: [],
        changes: [],
        message: row.parseWarning
          ? 'Novo passageiro com informação que deverá ser revisada depois da importação.'
          : 'Novo passageiro identificado na lista.',
      })
      continue
    }

    const changes = calculatePassengerChanges(matched, row)
    const protectedManualEdit = changes.length > 0 && passengerWasEditedManually(matched)
    items.push({
      id: row.rowKey,
      row,
      status: protectedManualEdit ? 'CONFLICT' : changes.length > 0 ? 'CHANGED' : 'UNCHANGED',
      matchedPassengerId: matched.id,
      candidatePassengerIds: [matched.id],
      changes: protectedManualEdit ? [] : changes,
      message: protectedManualEdit
        ? 'Este cadastro foi criado ou alterado manualmente depois da última importação. A nova lista diverge dele, por isso o aplicativo não substituirá a correção automaticamente.'
        : changes.length > 0
          ? `${changes.length} ${changes.length === 1 ? 'informação será atualizada' : 'informações serão atualizadas'}.`
          : 'Cadastro já está igual à nova lista.',
    })
  }

  return {
    fingerprint,
    fileNames,
    analyzedAt: now(),
    totalRows: items.length,
    newCount: items.filter((item) => item.status === 'NEW').length,
    changedCount: items.filter((item) => item.status === 'CHANGED').length,
    unchangedCount: items.filter((item) => item.status === 'UNCHANGED').length,
    conflictCount: items.filter((item) => item.status === 'CONFLICT').length,
    warningCount: items.filter((item) => Boolean(item.row.parseWarning)).length,
    alreadyImportedAt: importedBatch?.importedAt,
    items,
  }
}

export async function listPassengerImportBatches(): Promise<PassengerImportBatch[]> {
  const database = await getDatabase()
  const batches = await database.getAll('passengerImportBatches')
  return batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export async function applyPassengerPdfUpdate(
  preview: PassengerUpdatePreview,
): Promise<PassengerUpdateApplyResult> {
  const database = await getDatabase()
  const alreadyImported = await database.getFromIndex(
    'passengerImportBatches',
    'by-fingerprint',
    preview.fingerprint,
  )
  if (alreadyImported) {
    throw new Error('Estes mesmos arquivos já foram aplicados anteriormente. Nenhum cadastro foi duplicado.')
  }

  const timestamp = now()
  const transaction = database.transaction(
    ['passengers', 'passengerImportBatches'],
    'readwrite',
  )
  const passengerStore = transaction.objectStore('passengers')
  const batchStore = transaction.objectStore('passengerImportBatches')
  let insertedCount = 0
  let updatedCount = 0

  for (const item of preview.items) {
    const row = item.row

    if (item.status === 'NEW') {
      const passenger: Passenger = {
        id: newId('passenger'),
        fullName: row.fullName.trim(),
        normalizedName: normalizeText(row.fullName),
        city: row.city,
        phone: row.phone?.trim() ?? '',
        travelPeriod: row.travelPeriod || 'FIRST_WEEK',
        documentNumber: row.documentNumber.trim(),
        documentType: row.documentType,
        busType: row.busType,
        reviewStatus: row.parseWarning ? 'REVIEW' : row.reviewStatus ?? 'CONFIRMED',
        importWarning: row.parseWarning,
        importSourceKey: row.rowKey,
        importSourceFile: row.sourceFile,
        importSourcePage: row.sourcePage,
        sourceRole: row.sourceRole,
        importedAt: timestamp,
        notes: row.notes?.trim() ?? '',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await passengerStore.add(passenger)
      insertedCount += 1
      continue
    }

    if (item.status === 'CHANGED' && item.matchedPassengerId) {
      const stored = await passengerStore.get(item.matchedPassengerId)
      if (!stored) continue
      const passenger = withPassengerDefaults(stored)
      const updated: Passenger = {
        ...passenger,
        fullName: row.fullName.trim(),
        normalizedName: normalizeText(row.fullName),
        city: row.city || passenger.city,
        phone: row.phone !== undefined ? row.phone.trim() : passenger.phone,
        travelPeriod: row.travelPeriod || passenger.travelPeriod,
        documentNumber: row.documentNumber.trim() || passenger.documentNumber,
        documentType: row.documentNumber ? row.documentType : passenger.documentType,
        busType: row.busType === 'UNSPECIFIED' ? passenger.busType : row.busType,
        sourceRole: row.sourceRole,
        reviewStatus: row.parseWarning ? 'REVIEW' : row.reviewStatus ?? passenger.reviewStatus,
        reviewResolvedAt:
          (row.reviewStatus === 'REVIEW' || row.parseWarning)
            ? undefined
            : row.reviewStatus === 'CONFIRMED' && passenger.reviewStatus === 'REVIEW'
              ? timestamp
              : passenger.reviewResolvedAt,
        importWarning: appendImportWarning(passenger.importWarning, row.parseWarning),
        notes: row.notes !== undefined ? row.notes.trim() : passenger.notes,
        lastUpdateSourceFile: row.sourceFile,
        lastUpdateSourcePage: row.sourcePage,
        lastUpdatedFromImportAt: timestamp,
        updatedAt: timestamp,
      }
      await passengerStore.put(updated)
      updatedCount += 1
      continue
    }

    if (item.status === 'CONFLICT' && item.candidatePassengerIds.length > 0) {
      const warning = `Conflito encontrado na atualização ${importRowLocation(row)}: ${item.message}`
      for (const candidateId of item.candidatePassengerIds) {
        const stored = await passengerStore.get(candidateId)
        if (!stored) continue
        const passenger = withPassengerDefaults(stored)
        await passengerStore.put({
          ...passenger,
          reviewStatus: 'REVIEW',
          reviewResolvedAt: undefined,
          importWarning: appendImportWarning(passenger.importWarning, warning),
          lastUpdateSourceFile: row.sourceFile,
          lastUpdateSourcePage: row.sourcePage,
          lastUpdatedFromImportAt: timestamp,
          updatedAt: timestamp,
        })
      }
    }
  }

  const batch: PassengerImportBatch = {
    id: newId('passenger_import_batch'),
    fingerprint: preview.fingerprint,
    fileNames: preview.fileNames,
    importedAt: timestamp,
    totalRows: preview.totalRows,
    newCount: preview.newCount,
    updatedCount,
    unchangedCount: preview.unchangedCount,
    conflictCount: preview.conflictCount,
    warningCount: preview.warningCount,
    conflictNotes: preview.items
      .filter((item) => item.status === 'CONFLICT')
      .map((item) => `${item.row.fullName || 'Linha não identificada'} (${importRowLocation(item.row)}): ${item.message}`),
  }
  await batchStore.add(batch)
  await transaction.done

  return {
    batch,
    insertedCount,
    updatedCount,
    conflictCount: preview.conflictCount,
  }
}


function emptyStageCounts(): Record<Luggage['currentStage'], number> {
  return {
    WAREHOUSE_INITIAL: 0,
    TRAILER_OUTBOUND: 0,
    WITH_PASSENGER: 0,
    TRAILER_RETURN: 0,
    WAREHOUSE_RETURN: 0,
    DELIVERED_TO_CITY: 0,
  }
}

function closureHasDivergence(closure: OperationClosure) {
  return (
    closure.remainingLuggageIds.length > 0 ||
    closure.unexpectedLuggageIds.length > 0 ||
    closure.passengerIdsWithoutLuggage.length > 0
  )
}

export async function getPendenciesReport(): Promise<PendenciesReport> {
  const database = await getDatabase()
  const [passengers, allLuggage, movements, closures, cityTransfers] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
    database.getAll('operationClosures'),
    database.getAll('cityTransfers'),
  ])

  const passengerMap = new Map(passengers.map((passenger) => [passenger.id, passenger]))
  const luggageMap = new Map(allLuggage.map((item) => [item.id, item]))
  const luggageCountByPassenger = new Map<string, number>()
  const stageCounts = emptyStageCounts()

  for (const item of allLuggage) {
    luggageCountByPassenger.set(
      item.passengerId,
      (luggageCountByPassenger.get(item.passengerId) ?? 0) + 1,
    )
    stageCounts[item.currentStage] += 1
  }

  const latestMovementByLuggage = new Map<string, LuggageMovement>()
  for (const movement of movements) {
    const current = latestMovementByLuggage.get(movement.luggageId)
    if (!current || movement.occurredAt > current.occurredAt) {
      latestMovementByLuggage.set(movement.luggageId, movement)
    }
  }

  const luggage: PendenciesReport['luggage'] = []
  for (const item of allLuggage) {
    const passenger = passengerMap.get(item.passengerId)
    if (!passenger) continue
    luggage.push({
      ...item,
      passenger,
      latestMovement: latestMovementByLuggage.get(item.id),
    })
  }
  luggage.sort((a, b) => {
    const passengerOrder = a.passenger.fullName.localeCompare(
      b.passenger.fullName,
      'pt-BR',
    )
    return passengerOrder || a.code.localeCompare(b.code, 'pt-BR', { numeric: true })
  })

  const movementTimeline: PendenciesReport['movementTimeline'] = movements
    .map((movement) => {
      const movementLuggage = luggageMap.get(movement.luggageId)
      if (!movementLuggage) return null
      const passenger = passengerMap.get(movementLuggage.passengerId)
      if (!passenger) return null
      return {
        movement,
        luggage: movementLuggage,
        passenger,
      }
    })
    .filter(
      (item): item is PendenciesReport['movementTimeline'][number] => Boolean(item),
    )
    .sort((a, b) => a.movement.occurredAt.localeCompare(b.movement.occurredAt))

  const passengersWithoutLuggage = passengers.filter(
    (passenger) => !(luggageCountByPassenger.get(passenger.id) ?? 0),
  )
  const exceptionMovements = movements.filter((movement) => movement.isException)

  const latestClosureByOperation = new Map<OperationKey, OperationClosure>()
  for (const closure of [...closures].sort((a, b) =>
    b.finalizedAt.localeCompare(a.finalizedAt),
  )) {
    if (!latestClosureByOperation.has(closure.operationKey)) {
      latestClosureByOperation.set(closure.operationKey, closure)
    }
  }
  const divergentLatestClosures = Array.from(latestClosureByOperation.values()).filter(
    closureHasDivergence,
  )
  const divergentCityTransfers = cityTransfers.filter(transferHasMissingItems)

  const pendencies: CentralPendency[] = [
    ...passengersWithoutLuggage.map((passenger) => ({
      id: `passenger_without_luggage_${passenger.id}`,
      kind: 'PASSENGER_WITHOUT_LUGGAGE' as const,
      occurredAt: passenger.updatedAt,
      passenger,
    })),
    ...exceptionMovements.map((movement) => ({
      id: `movement_exception_${movement.id}`,
      kind: 'MOVEMENT_EXCEPTION' as const,
      occurredAt: movement.occurredAt,
      movement,
      luggage: luggageMap.get(movement.luggageId),
      passenger: luggageMap.get(movement.luggageId)
        ? passengerMap.get(luggageMap.get(movement.luggageId)!.passengerId)
        : undefined,
    })),
    ...divergentLatestClosures.map((closure) => ({
      id: `closure_divergence_${closure.id}`,
      kind: 'CLOSURE_DIVERGENCE' as const,
      occurredAt: closure.finalizedAt,
      closure,
    })),
    ...divergentCityTransfers.map((cityTransfer) => ({
      id: `city_transfer_divergence_${cityTransfer.id}`,
      kind: 'CITY_TRANSFER_DIVERGENCE' as const,
      occurredAt: cityTransfer.finalizedAt ?? cityTransfer.updatedAt,
      cityTransfer,
    })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  const cityMap = new Map<string, CityReportSummary>()
  for (const passenger of passengers) {
    const current = cityMap.get(passenger.city) ?? {
      city: passenger.city,
      passengerCount: 0,
      luggageCount: 0,
      stageCounts: emptyStageCounts(),
    }
    current.passengerCount += 1
    cityMap.set(passenger.city, current)
  }
  for (const item of allLuggage) {
    const passenger = passengerMap.get(item.passengerId)
    if (!passenger) continue
    const current = cityMap.get(passenger.city)
    if (!current) continue
    current.luggageCount += 1
    current.stageCounts[item.currentStage] += 1
  }

  const periodOrder: Passenger['travelPeriod'][] = [
    'FIRST_WEEK',
    'SECOND_WEEK',
    'BOTH_WEEKS',
  ]
  const periodMap = new Map<Passenger['travelPeriod'], PeriodReportSummary>(
    periodOrder.map((travelPeriod) => [
      travelPeriod,
      {
        travelPeriod,
        passengerCount: 0,
        luggageCount: 0,
        stageCounts: emptyStageCounts(),
      },
    ]),
  )
  for (const passenger of passengers) {
    periodMap.get(passenger.travelPeriod)!.passengerCount += 1
  }
  for (const item of allLuggage) {
    const passenger = passengerMap.get(item.passengerId)
    if (!passenger) continue
    const current = periodMap.get(passenger.travelPeriod)!
    current.luggageCount += 1
    current.stageCounts[item.currentStage] += 1
  }

  return {
    generatedAt: now(),
    passengerCount: passengers.length,
    luggageCount: allLuggage.length,
    passengerWithoutLuggageCount: passengersWithoutLuggage.length,
    exceptionCount: exceptionMovements.length,
    divergentClosureCount:
      divergentLatestClosures.length + divergentCityTransfers.length,
    activePendencyCount:
      passengersWithoutLuggage.length +
      exceptionMovements.length +
      divergentLatestClosures.length +
      divergentCityTransfers.length,
    stageCounts,
    pendencies,
    luggage,
    movementTimeline,
    closures: [...closures].sort((a, b) =>
      b.finalizedAt.localeCompare(a.finalizedAt),
    ),
    citySummaries: Array.from(cityMap.values()).sort((a, b) =>
      a.city.localeCompare(b.city, 'pt-BR'),
    ),
    periodSummaries: periodOrder.map((period) => periodMap.get(period)!),
  }
}

function isPassengerEligibleForOperation(
  operationKey: OperationKey,
  passenger: Passenger,
) {
  return OPERATION_DEFINITIONS[operationKey].eligiblePeriods.includes(
    passenger.travelPeriod,
  )
}

function stageOrder(stage: Luggage['currentStage']) {
  const order: Record<Luggage['currentStage'], number> = {
    WAREHOUSE_INITIAL: 0,
    TRAILER_OUTBOUND: 1,
    WITH_PASSENGER: 2,
    TRAILER_RETURN: 3,
    WAREHOUSE_RETURN: 4,
    DELIVERED_TO_CITY: 5,
  }
  return order[stage]
}

function operationMismatchMessage(
  operationKey: OperationKey,
  passenger: Passenger,
) {
  if (operationKey === 'DELIVER_FIRST_WEEK' && passenger.travelPeriod === 'SECOND_WEEK') {
    return 'Esta bagagem pertence à 2ª semana e deve permanecer na carreta agora.'
  }
  if (operationKey === 'COLLECT_FIRST_WEEK' && passenger.travelPeriod === 'BOTH_WEEKS') {
    return 'Este passageiro ficará as duas semanas. A bagagem deve ser recolhida apenas no final da 2ª semana.'
  }
  if (operationKey === 'COLLECT_FIRST_WEEK' && passenger.travelPeriod === 'SECOND_WEEK') {
    return 'Esta bagagem pertence à 2ª semana e ainda não deveria estar com o passageiro.'
  }
  if (operationKey === 'DELIVER_SECOND_WEEK' && passenger.travelPeriod !== 'SECOND_WEEK') {
    return 'Esta bagagem não pertence à entrega exclusiva da 2ª semana.'
  }
  if (operationKey === 'COLLECT_SECOND_WEEK' && passenger.travelPeriod === 'FIRST_WEEK') {
    return 'Esta bagagem pertence somente à 1ª semana e já deveria estar na carreta de retorno.'
  }
  return 'A bagagem não pertence ao período esperado para esta operação.'
}

function movementMatchesOperation(
  movement: LuggageMovement,
  operationKey: OperationKey,
  passenger: Passenger,
) {
  if (movement.operationKey) {
    return movement.operationKey === operationKey
  }

  if (
    operationKey === 'WAREHOUSE_TO_TRAILER' &&
    movement.type === 'WAREHOUSE_TO_TRAILER'
  ) {
    return true
  }

  if (
    operationKey === 'TRAILER_TO_WAREHOUSE' &&
    movement.type === 'TRAILER_TO_WAREHOUSE'
  ) {
    return true
  }

  if (movement.type === 'TRAILER_TO_PASSENGER') {
    if (passenger.travelPeriod === 'SECOND_WEEK') {
      return operationKey === 'DELIVER_SECOND_WEEK'
    }
    return operationKey === 'DELIVER_FIRST_WEEK'
  }

  if (movement.type === 'PASSENGER_TO_TRAILER') {
    if (passenger.travelPeriod === 'FIRST_WEEK') {
      return operationKey === 'COLLECT_FIRST_WEEK'
    }
    return operationKey === 'COLLECT_SECOND_WEEK'
  }

  return false
}

export async function getOperationSnapshot(
  operationKey: OperationKey,
): Promise<OperationSnapshot> {
  const database = await getDatabase()
  const definition = OPERATION_DEFINITIONS[operationKey]
  const [passengers, allLuggage, allMovements, closures] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
    database.getAllFromIndex('operationClosures', 'by-operation', operationKey),
  ])

  const eligiblePassengers = passengers
    .filter((passenger) => isPassengerEligibleForOperation(operationKey, passenger))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'))

  const passengerMap = new Map(
    eligiblePassengers.map((passenger) => [passenger.id, passenger]),
  )
  const movementsByLuggage = new Map<string, LuggageMovement[]>()

  for (const movement of allMovements) {
    const current = movementsByLuggage.get(movement.luggageId) ?? []
    current.push(movement)
    movementsByLuggage.set(movement.luggageId, current)
  }

  const groupedLuggage = new Map<string, OperationLuggageItem[]>()

  for (const item of allLuggage) {
    const passenger = passengerMap.get(item.passengerId)
    if (!passenger) continue

    const completed = (movementsByLuggage.get(item.id) ?? []).some((movement) =>
      movementMatchesOperation(movement, operationKey, passenger),
    )
    const pending = !completed && item.currentStage === definition.fromStage
    const unexpected = !completed && !pending

    const enriched: OperationLuggageItem = {
      ...item,
      passenger,
      isPending: pending,
      isCompleted: completed,
      isUnexpected: unexpected,
    }

    const current = groupedLuggage.get(passenger.id) ?? []
    current.push(enriched)
    groupedLuggage.set(passenger.id, current)
  }

  const groups: OperationPassengerGroup[] = eligiblePassengers.map((passenger) => {
    const luggage = (groupedLuggage.get(passenger.id) ?? []).sort((a, b) =>
      a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
    )
    return {
      passenger,
      luggage,
      totalCount: luggage.length,
      pendingCount: luggage.filter((item) => item.isPending).length,
      completedCount: luggage.filter((item) => item.isCompleted).length,
      unexpectedCount: luggage.filter((item) => item.isUnexpected).length,
    }
  })

  const items = groups.flatMap((group) => group.luggage)
  const latestClosure = closures.sort((a, b) =>
    b.finalizedAt.localeCompare(a.finalizedAt),
  )[0]

  return {
    operationKey,
    groups,
    totalLuggage: items.length,
    pendingLuggage: items.filter((item) => item.isPending).length,
    completedLuggage: items.filter((item) => item.isCompleted).length,
    unexpectedLuggage: items.filter((item) => item.isUnexpected).length,
    passengersWithoutLuggage: definition.emptyPassengerWarning
      ? eligiblePassengers.filter(
          (passenger) => !(groupedLuggage.get(passenger.id)?.length),
        )
      : [],
    latestClosure,
  }
}

export async function checkLuggageForOperation(
  operationKey: OperationKey,
  rawCode: string,
): Promise<OperationScanCheck> {
  const database = await getDatabase()
  const definition = OPERATION_DEFINITIONS[operationKey]
  const normalizedCode = normalizeCode(rawCode)

  if (!normalizedCode) {
    return {
      status: 'NOT_FOUND',
      message: 'Digite ou escaneie o código da bagagem.',
    }
  }

  const luggage = await database.getFromIndex('luggage', 'by-code', normalizedCode)
  if (!luggage) {
    return {
      status: 'NOT_FOUND',
      message: `Nenhuma bagagem foi encontrada com o código ${rawCode.trim()}.`,
    }
  }

  const passenger = await database.get('passengers', luggage.passengerId)
  if (!passenger) {
    return {
      status: 'BLOCKED',
      message: 'O dono desta bagagem não foi encontrado. A movimentação foi bloqueada.',
      luggage,
    }
  }

  const luggageMovements = await database.getAllFromIndex(
    'movements',
    'by-luggage',
    luggage.id,
  )
  if (
    luggageMovements.some((movement) =>
      movementMatchesOperation(movement, operationKey, passenger),
    )
  ) {
    return {
      status: 'ALREADY_COMPLETED',
      message: `A bagagem ${luggage.code} já foi registrada nesta etapa.`,
      luggage,
      passenger,
    }
  }

  if (luggage.currentStage === definition.toStage) {
    return {
      status: 'ALREADY_COMPLETED',
      message: `A bagagem ${luggage.code} já foi registrada nesta etapa.`,
      luggage,
      passenger,
    }
  }

  if (stageOrder(luggage.currentStage) > stageOrder(definition.toStage)) {
    return {
      status: 'BLOCKED',
      message: `A bagagem ${luggage.code} já está em uma etapa posterior. O histórico não pode ser retrocedido por esta tela.`,
      luggage,
      passenger,
    }
  }

  if (!isPassengerEligibleForOperation(operationKey, passenger)) {
    return {
      status: 'REQUIRES_CONFIRMATION',
      message: operationMismatchMessage(operationKey, passenger),
      luggage,
      passenger,
    }
  }

  if (luggage.currentStage !== definition.fromStage) {
    return {
      status: 'REQUIRES_CONFIRMATION',
      message: `O cadastro informa que esta bagagem está em “${STAGE_LABELS[luggage.currentStage]}”, e não em “${STAGE_LABELS[definition.fromStage]}”.`,
      luggage,
      passenger,
    }
  }

  return {
    status: 'READY',
    message: definition.successMessage,
    luggage,
    passenger,
  }
}

export async function moveLuggageForOperation(
  operationKey: OperationKey,
  luggageId: string,
  options?: {
    photoId?: string
    exceptionReason?: string
  },
): Promise<LuggageMovement> {
  const database = await getDatabase()
  const definition = OPERATION_DEFINITIONS[operationKey]
  const transaction = database.transaction(
    ['passengers', 'luggage', 'movements', 'photos'],
    'readwrite',
  )
  const passengerStore = transaction.objectStore('passengers')
  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const luggage = await luggageStore.get(luggageId)

  if (!luggage) {
    throw new Error('A bagagem não foi encontrada.')
  }

  if (luggage.currentStage === definition.toStage) {
    throw new Error(`A bagagem ${luggage.code} já foi registrada nesta etapa.`)
  }

  const passenger = await passengerStore.get(luggage.passengerId)
  if (!passenger) {
    throw new Error('O dono desta bagagem não foi encontrado.')
  }

  const luggageMovements = await movementStore.index('by-luggage').getAll(luggage.id)
  if (
    luggageMovements.some((movement) =>
      movementMatchesOperation(movement, operationKey, passenger),
    )
  ) {
    throw new Error(`A bagagem ${luggage.code} já foi registrada nesta etapa.`)
  }

  if (stageOrder(luggage.currentStage) > stageOrder(definition.toStage)) {
    throw new Error('A bagagem já está em uma etapa posterior e não pode retroceder por esta operação.')
  }

  const needsException =
    luggage.currentStage !== definition.fromStage ||
    !isPassengerEligibleForOperation(operationKey, passenger)
  if (needsException && !options?.exceptionReason?.trim()) {
    throw new Error('Esta movimentação foge do fluxo previsto e exige uma justificativa.')
  }

  if (!options?.photoId) {
    throw new Error('Registre a foto do conjunto deste passageiro antes de movimentar as bagagens.')
  }

  const evidencePhoto = await photoStore.get(options.photoId)
  if (
    !evidencePhoto ||
    evidencePhoto.kind !== 'OPERATION_EVIDENCE' ||
    evidencePhoto.operationKey !== operationKey ||
    evidencePhoto.passengerId !== passenger.id
  ) {
    throw new Error('A foto selecionada não pertence a este passageiro e a esta etapa.')
  }

  const timestamp = now()
  const isException = needsException
  const movement: LuggageMovement = {
    id: newId('movement'),
    luggageId: luggage.id,
    type: definition.movementType,
    operationKey,
    fromStage: luggage.currentStage,
    toStage: definition.toStage,
    occurredAt: timestamp,
    note: definition.successMessage,
    photoIds: options?.photoId ? [options.photoId] : [],
    isException,
    exceptionReason: options?.exceptionReason?.trim() || undefined,
  }

  await luggageStore.put({
    ...luggage,
    currentStage: definition.toStage,
    updatedAt: timestamp,
  })
  await movementStore.add(movement)
  await transaction.done
  return movement
}

export async function getLatestOperationEvidencePhoto(
  operationKey: OperationKey,
  passengerId: string,
): Promise<PhotoRecord | undefined> {
  const database = await getDatabase()
  const passengerPhotos = await database.getAllFromIndex('photos', 'by-passenger', passengerId)
  return passengerPhotos
    .filter(
      (photo) =>
        photo.kind === 'OPERATION_EVIDENCE' && photo.operationKey === operationKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

export async function saveOperationEvidencePhoto(
  operationKey: OperationKey,
  passengerId: string,
  input: PhotoInput,
): Promise<PhotoRecord> {
  const database = await getDatabase()
  const timestamp = now()
  const photo: PhotoRecord = {
    id: newId('photo'),
    kind: 'OPERATION_EVIDENCE',
    passengerId,
    luggageId: '',
    operationKey,
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await database.add('photos', photo)
  return photo
}

export async function finalizeOperation(
  operationKey: OperationKey,
  note: string,
): Promise<OperationClosure> {
  const database = await getDatabase()
  const snapshot = await getOperationSnapshot(operationKey)
  const closure: OperationClosure = {
    id: newId('closure'),
    operationKey,
    finalizedAt: now(),
    note: note.trim(),
    completedCount: snapshot.completedLuggage,
    remainingLuggageIds: snapshot.groups
      .flatMap((group) => group.luggage)
      .filter((item) => item.isPending)
      .map((item) => item.id),
    unexpectedLuggageIds: snapshot.groups
      .flatMap((group) => group.luggage)
      .filter((item) => item.isUnexpected)
      .map((item) => item.id),
    passengerIdsWithoutLuggage: snapshot.passengersWithoutLuggage.map(
      (passenger) => passenger.id,
    ),
  }
  await database.add('operationClosures', closure)
  return closure
}


function cityPassengerMap(passengers: Passenger[], city: string) {
  return new Map(
    passengers
      .filter((passenger) => passenger.city === city)
      .map((passenger) => [passenger.id, passenger]),
  )
}

function transferHasMissingItems(transfer: CityTransfer) {
  return transfer.status === 'FINALIZED' && transfer.missingLuggageIds.length > 0
}

export async function getCityDeliveryOverview(): Promise<CityDeliveryOverview> {
  const database = await getDatabase()
  const [passengers, allLuggage, transfers] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('cityTransfers'),
  ])

  const finalizedTransfers = transfers
    .filter((transfer) => transfer.status === 'FINALIZED')
    .sort((a, b) => (b.finalizedAt ?? b.updatedAt).localeCompare(a.finalizedAt ?? a.updatedAt))

  const cities = CITIES.map((city) => {
    const cityPassengers = passengers.filter((passenger) => passenger.city === city)
    const cityPassengerIds = new Set(cityPassengers.map((passenger) => passenger.id))
    const cityLuggage = allLuggage.filter((item) => cityPassengerIds.has(item.passengerId))
    const cityTransfers = transfers
      .filter((transfer) => transfer.city === city && transfer.status === 'FINALIZED')
      .sort((a, b) => (b.finalizedAt ?? b.updatedAt).localeCompare(a.finalizedAt ?? a.updatedAt))
    const draft = transfers.find(
      (transfer) => transfer.city === city && transfer.status === 'DRAFT',
    )

    return {
      city,
      passengerCount: cityPassengers.length,
      luggageCount: cityLuggage.length,
      readyCount: cityLuggage.filter((item) => item.currentStage === 'WAREHOUSE_RETURN').length,
      deliveredCount: cityLuggage.filter((item) => item.currentStage === 'DELIVERED_TO_CITY').length,
      notReadyCount: cityLuggage.filter(
        (item) =>
          item.currentStage !== 'WAREHOUSE_RETURN' &&
          item.currentStage !== 'DELIVERED_TO_CITY',
      ).length,
      draftScannedCount: draft?.scannedLuggageIds.filter((id) =>
        cityLuggage.some((item) => item.id === id && item.currentStage === 'WAREHOUSE_RETURN'),
      ).length ?? 0,
      latestTransfer: cityTransfers[0],
    }
  })


  return {
    generatedAt: now(),
    cities,
    finalizedTransfers,
  }
}

export async function getOrCreateCityTransferDraft(city: string): Promise<CityTransfer> {
  const database = await getDatabase()
  const cityTransfers = await database.getAllFromIndex('cityTransfers', 'by-city', city)
  const existing = cityTransfers
    .filter((transfer) => transfer.status === 'DRAFT')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (existing) return existing

  const timestamp = now()
  const transfer: CityTransfer = {
    id: newId('city_transfer'),
    city,
    status: 'DRAFT',
    responsibleName: '',
    vehicleDescription: '',
    vehiclePlate: '',
    note: '',
    scannedLuggageIds: [],
    expectedLuggageIds: [],
    missingLuggageIds: [],
    issueNote: '',
    startedAt: timestamp,
    updatedAt: timestamp,
  }
  await database.add('cityTransfers', transfer)
  return transfer
}

export async function getCityTransferWorkspace(
  city: string,
): Promise<CityTransferWorkspace> {
  const database = await getDatabase()
  let transfer = await getOrCreateCityTransferDraft(city)
  const [passengers, allLuggage, allMovements] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
  ])
  const passengerMap = cityPassengerMap(passengers, city)
  const cityLuggage = allLuggage.filter((item) => passengerMap.has(item.passengerId))
  const validScannedIds = transfer.scannedLuggageIds.filter((id) =>
    cityLuggage.some((item) => item.id === id && item.currentStage === 'WAREHOUSE_RETURN'),
  )
  if (validScannedIds.length !== transfer.scannedLuggageIds.length) {
    transfer = {
      ...transfer,
      scannedLuggageIds: validScannedIds,
      updatedAt: now(),
    }
    await database.put('cityTransfers', transfer)
  }

  const latestMovementByLuggage = new Map<string, LuggageMovement>()
  for (const movement of allMovements) {
    const current = latestMovementByLuggage.get(movement.luggageId)
    if (!current || movement.occurredAt > current.occurredAt) {
      latestMovementByLuggage.set(movement.luggageId, movement)
    }
  }

  const luggage: LuggageReportItem[] = cityLuggage
    .map((item) => ({
      ...item,
      passenger: passengerMap.get(item.passengerId)!,
      latestMovement: latestMovementByLuggage.get(item.id),
    }))
    .sort((a, b) => {
      const ownerOrder = a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR')
      return ownerOrder || a.code.localeCompare(b.code, 'pt-BR', { numeric: true })
    })

  return {
    transfer,
    city,
    passengerCount: passengerMap.size,
    luggage,
    totalCount: cityLuggage.length,
    readyCount: cityLuggage.filter((item) => item.currentStage === 'WAREHOUSE_RETURN').length,
    scannedCount: validScannedIds.length,
    notReadyCount: cityLuggage.filter(
      (item) =>
        item.currentStage !== 'WAREHOUSE_RETURN' &&
        item.currentStage !== 'DELIVERED_TO_CITY',
    ).length,
    deliveredCount: cityLuggage.filter((item) => item.currentStage === 'DELIVERED_TO_CITY').length,
  }
}

export async function saveCityTransferDraftDetails(
  transferId: string,
  input: CityTransferDetailsInput,
): Promise<CityTransfer> {
  const database = await getDatabase()
  const transfer = await database.get('cityTransfers', transferId)
  if (!transfer || transfer.status !== 'DRAFT') {
    throw new Error('A transferência em andamento não foi encontrada.')
  }

  const updated: CityTransfer = {
    ...transfer,
    responsibleName: input.responsibleName.trim(),
    vehicleDescription: input.vehicleDescription.trim(),
    vehiclePlate: input.vehiclePlate.trim().toLocaleUpperCase('pt-BR'),
    note: input.note.trim(),
    updatedAt: now(),
  }
  await database.put('cityTransfers', updated)
  return updated
}

export async function checkLuggageForCityTransfer(
  city: string,
  transferId: string,
  rawCode: string,
): Promise<CityTransferScanCheck> {
  const database = await getDatabase()
  const normalizedCode = normalizeCode(rawCode)
  if (!normalizedCode) {
    return { status: 'NOT_FOUND', message: 'Digite ou escaneie o código da bagagem.' }
  }

  const [transfer, luggage] = await Promise.all([
    database.get('cityTransfers', transferId),
    database.getFromIndex('luggage', 'by-code', normalizedCode),
  ])
  if (!transfer || transfer.status !== 'DRAFT' || transfer.city !== city) {
    return { status: 'BLOCKED', message: 'A conferência desta cidade não está mais ativa.' }
  }
  if (!luggage) {
    return {
      status: 'NOT_FOUND',
      message: `Nenhuma bagagem foi encontrada com o código ${rawCode.trim()}.`,
    }
  }

  const passenger = await database.get('passengers', luggage.passengerId)
  if (!passenger) {
    return {
      status: 'BLOCKED',
      message: 'O passageiro vinculado à bagagem não foi encontrado.',
      luggage,
    }
  }
  if (passenger.city !== city) {
    return {
      status: 'WRONG_CITY',
      message: `A bagagem ${luggage.code} pertence a ${passenger.city}, e não a ${city}.`,
      luggage,
      passenger,
    }
  }
  if (transfer.scannedLuggageIds.includes(luggage.id)) {
    return {
      status: 'ALREADY_SCANNED',
      message: `A bagagem ${luggage.code} já foi conferida nesta transferência.`,
      luggage,
      passenger,
    }
  }
  if (luggage.currentStage === 'DELIVERED_TO_CITY') {
    return {
      status: 'ALREADY_DELIVERED',
      message: `A bagagem ${luggage.code} já foi entregue à cidade anteriormente.`,
      luggage,
      passenger,
    }
  }
  if (luggage.currentStage !== 'WAREHOUSE_RETURN') {
    return {
      status: 'NOT_READY',
      message: `A bagagem ${luggage.code} ainda está em “${STAGE_LABELS[luggage.currentStage]}” e não pode ser entregue ao caminhão da cidade.`,
      luggage,
      passenger,
    }
  }

  return {
    status: 'READY',
    message: 'Bagagem pronta para ser vinculada à transferência.',
    luggage,
    passenger,
  }
}

export async function addLuggageToCityTransferDraft(
  transferId: string,
  luggageId: string,
): Promise<CityTransfer> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['cityTransfers', 'luggage', 'passengers'],
    'readwrite',
  )
  const transferStore = transaction.objectStore('cityTransfers')
  const luggageStore = transaction.objectStore('luggage')
  const passengerStore = transaction.objectStore('passengers')
  const transfer = await transferStore.get(transferId)
  const luggage = await luggageStore.get(luggageId)

  if (!transfer || transfer.status !== 'DRAFT') {
    throw new Error('A transferência em andamento não foi encontrada.')
  }
  if (!luggage) throw new Error('A bagagem não foi encontrada.')
  const passenger = await passengerStore.get(luggage.passengerId)
  if (!passenger) throw new Error('O passageiro vinculado à bagagem não foi encontrado.')
  if (passenger.city !== transfer.city) {
    throw new Error(`Esta bagagem pertence a ${passenger.city}, e não a ${transfer.city}.`)
  }
  if (luggage.currentStage !== 'WAREHOUSE_RETURN') {
    throw new Error(`A bagagem está em “${STAGE_LABELS[luggage.currentStage]}” e ainda não está pronta para a entrega à cidade.`)
  }

  const updated: CityTransfer = {
    ...transfer,
    scannedLuggageIds: Array.from(new Set([...transfer.scannedLuggageIds, luggage.id])),
    updatedAt: now(),
  }
  await transferStore.put(updated)
  await transaction.done
  return updated
}

export async function removeLuggageFromCityTransferDraft(
  transferId: string,
  luggageId: string,
): Promise<CityTransfer> {
  const database = await getDatabase()
  const transfer = await database.get('cityTransfers', transferId)
  if (!transfer || transfer.status !== 'DRAFT') {
    throw new Error('A transferência em andamento não foi encontrada.')
  }
  const updated: CityTransfer = {
    ...transfer,
    scannedLuggageIds: transfer.scannedLuggageIds.filter((id) => id !== luggageId),
    updatedAt: now(),
  }
  await database.put('cityTransfers', updated)
  return updated
}

export async function finalizeCityTransfer(
  transferId: string,
  details: CityTransferDetailsInput,
  issueNote: string,
): Promise<CityTransferReceipt> {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['cityTransfers', 'passengers', 'luggage', 'movements'],
    'readwrite',
  )
  const transferStore = transaction.objectStore('cityTransfers')
  const passengerStore = transaction.objectStore('passengers')
  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const transfer = await transferStore.get(transferId)

  if (!transfer || transfer.status !== 'DRAFT') {
    throw new Error('A transferência em andamento não foi encontrada.')
  }

  const responsibleName = details.responsibleName.trim()
  const vehicleDescription = details.vehicleDescription.trim()
  const vehiclePlate = details.vehiclePlate.trim().toLocaleUpperCase('pt-BR')
  if (!responsibleName) throw new Error('Informe o responsável pelo recebimento.')
  if (!vehicleDescription) throw new Error('Informe o veículo que levará as bagagens.')
  if (!vehiclePlate) throw new Error('Informe a placa do veículo.')

  const [passengers, allLuggage] = await Promise.all([
    passengerStore.getAll(),
    luggageStore.getAll(),
  ])
  const passengerMap = cityPassengerMap(passengers, transfer.city)
  const cityLuggage = allLuggage.filter((item) => passengerMap.has(item.passengerId))
  const expected = cityLuggage.filter((item) => item.currentStage !== 'DELIVERED_TO_CITY')
  const scannedSet = new Set(transfer.scannedLuggageIds)
  const scanned = expected.filter((item) => scannedSet.has(item.id))
  const missing = expected.filter((item) => !scannedSet.has(item.id))

  if (scanned.length === 0) {
    throw new Error('Confira pelo menos uma bagagem antes de finalizar a transferência.')
  }
  for (const item of scanned) {
    if (item.currentStage !== 'WAREHOUSE_RETURN') {
      throw new Error(`A bagagem ${item.code} não está mais disponível no galpão de retorno.`)
    }
  }
  if (missing.length > 0 && !issueNote.trim()) {
    throw new Error('Existem volumes não transferidos. Informe a justificativa para finalizar.')
  }

  const timestamp = now()
  const finalTransfer: CityTransfer = {
    ...transfer,
    status: 'FINALIZED',
    responsibleName,
    vehicleDescription,
    vehiclePlate,
    note: details.note.trim(),
    scannedLuggageIds: scanned.map((item) => item.id),
    expectedLuggageIds: expected.map((item) => item.id),
    missingLuggageIds: missing.map((item) => item.id),
    issueNote: issueNote.trim(),
    updatedAt: timestamp,
    finalizedAt: timestamp,
  }

  for (const item of scanned) {
    await luggageStore.put({
      ...item,
      currentStage: 'DELIVERED_TO_CITY',
      updatedAt: timestamp,
    })
    await movementStore.add({
      id: newId('movement'),
      luggageId: item.id,
      type: 'WAREHOUSE_TO_CITY',
      cityTransferId: finalTransfer.id,
      fromStage: 'WAREHOUSE_RETURN',
      toStage: 'DELIVERED_TO_CITY',
      occurredAt: timestamp,
      note: `Bagagem entregue ao veículo de ${transfer.city}. Responsável: ${responsibleName}. Veículo: ${vehicleDescription} · Placa: ${vehiclePlate}.`,
      photoIds: [],
      isException: false,
    })
  }
  await transferStore.put(finalTransfer)
  await transaction.done

  return getCityTransferReceipt(finalTransfer.id)
}

export async function getCityTransferReceipt(
  transferId: string,
): Promise<CityTransferReceipt> {
  const database = await getDatabase()
  const [transfer, passengers, allLuggage] = await Promise.all([
    database.get('cityTransfers', transferId),
    database.getAll('passengers'),
    database.getAll('luggage'),
  ])
  if (!transfer) throw new Error('O comprovante desta transferência não foi encontrado.')

  const passengerMap = new Map(passengers.map((passenger) => [passenger.id, passenger]))
  const luggageMap = new Map(allLuggage.map((item) => [item.id, item]))
  const mapItems = (ids: string[]) =>
    ids
      .map((id) => {
        const luggage = luggageMap.get(id)
        const passenger = luggage ? passengerMap.get(luggage.passengerId) : undefined
        return luggage && passenger ? { luggage, passenger } : null
      })
      .filter((item): item is CityTransferReceipt['items'][number] => Boolean(item))
      .sort((a, b) =>
        a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR') ||
        a.luggage.code.localeCompare(b.luggage.code, 'pt-BR', { numeric: true }),
      )

  return {
    transfer,
    items: mapItems(transfer.scannedLuggageIds),
    missingItems: mapItems(transfer.missingLuggageIds),
  }
}


export async function getContingencySnapshot(): Promise<ContingencySnapshot> {
  const database = await getDatabase()
  const [passengers, allLuggage, movements, cityTransfers] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
    database.getAll('cityTransfers'),
  ])

  const passengerMap = new Map(passengers.map((passenger) => [passenger.id, passenger]))
  const luggageByPassenger = new Map<string, Luggage[]>()
  for (const item of allLuggage) {
    const current = luggageByPassenger.get(item.passengerId) ?? []
    current.push(item)
    luggageByPassenger.set(item.passengerId, current)
  }

  const movementsByLuggage = new Map<string, LuggageMovement[]>()
  for (const movement of movements) {
    const current = movementsByLuggage.get(movement.luggageId) ?? []
    current.push(movement)
    movementsByLuggage.set(movement.luggageId, current)
  }
  for (const itemMovements of movementsByLuggage.values()) {
    itemMovements.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  }

  const cityTransferMap = new Map(cityTransfers.map((transfer) => [transfer.id, transfer]))
  const passengersForExport = passengers
    .map((passenger) => ({
      passenger,
      luggageCount: luggageByPassenger.get(passenger.id)?.length ?? 0,
    }))
    .sort((a, b) => {
      const cityOrder = a.passenger.city.localeCompare(b.passenger.city, 'pt-BR')
      return cityOrder || a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR')
    })

  const luggageRows: ContingencySnapshot['luggageRows'] = []
  for (const luggage of allLuggage) {
    const passenger = passengerMap.get(luggage.passengerId)
    if (!passenger) continue
    const luggageMovements = movementsByLuggage.get(luggage.id) ?? []
    const cityMovement = [...luggageMovements]
      .reverse()
      .find((movement) => movement.type === 'WAREHOUSE_TO_CITY')
    const cityTransfer = cityMovement?.cityTransferId
      ? cityTransferMap.get(cityMovement.cityTransferId)
      : undefined
    luggageRows.push({
      luggage,
      passenger,
      movements: luggageMovements,
      ...(cityTransfer ? { cityTransfer } : {}),
    })
  }
  luggageRows.sort((a, b) => {
    const cityOrder = a.passenger.city.localeCompare(b.passenger.city, 'pt-BR')
    const passengerOrder = a.passenger.fullName.localeCompare(
      b.passenger.fullName,
      'pt-BR',
    )
    return (
      cityOrder ||
      passengerOrder ||
      a.luggage.code.localeCompare(b.luggage.code, 'pt-BR', { numeric: true })
    )
  })

  const cityMap = new Map<string, CityReportSummary>(
    CITIES.map((city) => [
      city,
      {
        city,
        passengerCount: 0,
        luggageCount: 0,
        stageCounts: emptyStageCounts(),
      },
    ]),
  )
  for (const passenger of passengers) {
    const summary = cityMap.get(passenger.city)
    if (summary) summary.passengerCount += 1
  }
  for (const item of allLuggage) {
    const passenger = passengerMap.get(item.passengerId)
    const summary = passenger ? cityMap.get(passenger.city) : undefined
    if (!summary) continue
    summary.luggageCount += 1
    summary.stageCounts[item.currentStage] += 1
  }

  const periodOrder: Passenger['travelPeriod'][] = [
    'FIRST_WEEK',
    'SECOND_WEEK',
    'BOTH_WEEKS',
  ]
  const periodMap = new Map<Passenger['travelPeriod'], PeriodReportSummary>(
    periodOrder.map((travelPeriod) => [
      travelPeriod,
      {
        travelPeriod,
        passengerCount: 0,
        luggageCount: 0,
        stageCounts: emptyStageCounts(),
      },
    ]),
  )
  for (const passenger of passengers) {
    periodMap.get(passenger.travelPeriod)!.passengerCount += 1
  }
  for (const item of allLuggage) {
    const passenger = passengerMap.get(item.passengerId)
    if (!passenger) continue
    const summary = periodMap.get(passenger.travelPeriod)!
    summary.luggageCount += 1
    summary.stageCounts[item.currentStage] += 1
  }

  const timestamps = [
    ...passengers.flatMap((passenger) => [passenger.createdAt, passenger.updatedAt]),
    ...allLuggage.flatMap((item) => [item.createdAt, item.updatedAt]),
    ...movements.map((movement) => movement.occurredAt),
    ...cityTransfers.flatMap((transfer) => [
      transfer.startedAt,
      transfer.updatedAt,
      transfer.finalizedAt ?? '',
    ]),
  ].filter(Boolean)

  return {
    generatedAt: now(),
    latestDataAt: timestamps.sort().at(-1) ?? now(),
    passengerCount: passengers.length,
    luggageCount: allLuggage.length,
    passengers: passengersForExport,
    luggageRows,
    citySummaries: CITIES.map((city) => cityMap.get(city)!),
    periodSummaries: periodOrder.map((period) => periodMap.get(period)!),
  }
}
