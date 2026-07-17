import { OPERATION_DEFINITIONS, STAGE_LABELS } from '../constants/operations'
import { getDatabase } from './appDatabase'
import type {
  CentralPendency,
  CityReportSummary,
  DashboardSummary,
  Luggage,
  LuggageInput,
  LuggageMovement,
  Passenger,
  PassengerInput,
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
  })

  for (const item of luggage) {
    counts.set(item.passengerId, (counts.get(item.passengerId) ?? 0) + 1)
    const passengerStageCounts = stageCounts.get(item.passengerId) ?? emptyStageCounts()
    passengerStageCounts[item.currentStage] += 1
    stageCounts.set(item.passengerId, passengerStageCounts)
  }

  return passengers
    .map((passenger) => ({
      ...passenger,
      luggageCount: counts.get(passenger.id) ?? 0,
      luggageStageCounts: stageCounts.get(passenger.id) ?? emptyStageCounts(),
    }))
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

  const passenger: Passenger = {
    id: existing?.id ?? newId('passenger'),
    fullName: input.fullName.trim(),
    normalizedName: normalizeText(input.fullName),
    city: input.city,
    phone: input.phone.trim(),
    travelPeriod: input.travelPeriod,
    notes: input.notes.trim(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  await database.put('passengers', passenger)
  return passenger
}

export async function deletePassengerPermanently(passengerId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(
    ['passengers', 'luggage', 'movements', 'photos'],
    'readwrite',
  )

  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const passengerLuggage = await luggageStore.index('by-passenger').getAll(passengerId)
  const passengerPhotoKeys = await photoStore.index('by-passenger').getAllKeys(passengerId)

  for (const luggage of passengerLuggage) {
    const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggage.id)
    await Promise.all(movementKeys.map((movementId) => movementStore.delete(movementId)))
    await luggageStore.delete(luggage.id)
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
  const transaction = database.transaction(['luggage', 'movements', 'photos'], 'readwrite')
  const movementStore = transaction.objectStore('movements')
  const photoStore = transaction.objectStore('photos')
  const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggageId)
  const photoKeys = await photoStore.index('by-luggage').getAllKeys(luggageId)

  await Promise.all(movementKeys.map((movementId) => movementStore.delete(movementId)))
  await Promise.all(photoKeys.map((photoId) => photoStore.delete(photoId)))
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
  const report = await getPendenciesReport()
  return {
    passengerCount: report.passengerCount,
    luggageCount: report.luggageCount,
    pendingCount: report.activePendencyCount,
  }
}


function emptyStageCounts(): Record<Luggage['currentStage'], number> {
  return {
    WAREHOUSE_INITIAL: 0,
    TRAILER_OUTBOUND: 0,
    WITH_PASSENGER: 0,
    TRAILER_RETURN: 0,
    WAREHOUSE_RETURN: 0,
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
  const [passengers, allLuggage, movements, closures] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
    database.getAll('movements'),
    database.getAll('operationClosures'),
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
    divergentClosureCount: divergentLatestClosures.length,
    activePendencyCount:
      passengersWithoutLuggage.length +
      exceptionMovements.length +
      divergentLatestClosures.length,
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
