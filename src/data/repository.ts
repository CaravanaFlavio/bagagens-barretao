import { getDatabase } from './appDatabase'
import type {
  DashboardSummary,
  Luggage,
  LuggageInput,
  LuggageMovement,
  Passenger,
  PassengerInput,
  PassengerSummary,
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

export async function listPassengers(): Promise<PassengerSummary[]> {
  const database = await getDatabase()
  const [passengers, luggage] = await Promise.all([
    database.getAll('passengers'),
    database.getAll('luggage'),
  ])

  const counts = new Map<string, number>()
  for (const item of luggage) {
    counts.set(item.passengerId, (counts.get(item.passengerId) ?? 0) + 1)
  }

  return passengers
    .map((passenger) => ({
      ...passenger,
      luggageCount: counts.get(passenger.id) ?? 0,
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
    ['passengers', 'luggage', 'movements'],
    'readwrite',
  )

  const luggageStore = transaction.objectStore('luggage')
  const movementStore = transaction.objectStore('movements')
  const passengerLuggage = await luggageStore.index('by-passenger').getAll(passengerId)

  for (const luggage of passengerLuggage) {
    const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggage.id)
    await Promise.all(movementKeys.map((movementId) => movementStore.delete(movementId)))
    await luggageStore.delete(luggage.id)
  }

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
  }

  const transaction = database.transaction(['luggage', 'movements'], 'readwrite')
  await transaction.objectStore('luggage').add(luggage)
  await transaction.objectStore('movements').add(movement)
  await transaction.done

  return luggage
}

export async function deleteLuggagePermanently(luggageId: string) {
  const database = await getDatabase()
  const transaction = database.transaction(['luggage', 'movements'], 'readwrite')
  const movementStore = transaction.objectStore('movements')
  const movementKeys = await movementStore.index('by-luggage').getAllKeys(luggageId)

  await Promise.all(movementKeys.map((movementId) => movementStore.delete(movementId)))
  await transaction.objectStore('luggage').delete(luggageId)
  await transaction.done
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const database = await getDatabase()
  const [passengerCount, luggageCount] = await Promise.all([
    database.count('passengers'),
    database.count('luggage'),
  ])

  return {
    passengerCount,
    luggageCount,
    pendingCount: 0,
  }
}
