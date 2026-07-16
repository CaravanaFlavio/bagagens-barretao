import { getDatabase } from './appDatabase'
import type {
  DashboardSummary,
  Luggage,
  LuggageInput,
  LuggageMovement,
  Passenger,
  PassengerInput,
  PassengerSummary,
  PhotoInput,
  PhotoRecord,
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
