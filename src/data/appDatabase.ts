import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  Luggage,
  LuggageMovement,
  LuggageStage,
  Passenger,
  PhotoKind,
  PhotoRecord,
  TravelPeriod,
} from '../domain/types'

interface BagagensDatabase extends DBSchema {
  passengers: {
    key: string
    value: Passenger
    indexes: {
      'by-name': string
      'by-city': string
      'by-period': TravelPeriod
    }
  }
  luggage: {
    key: string
    value: Luggage
    indexes: {
      'by-passenger': string
      'by-code': string
      'by-stage': LuggageStage
    }
  }
  movements: {
    key: string
    value: LuggageMovement
    indexes: {
      'by-luggage': string
      'by-date': string
    }
  }
  photos: {
    key: string
    value: PhotoRecord
    indexes: {
      'by-passenger': string
      'by-luggage': string
      'by-kind': PhotoKind
    }
  }
}

let databasePromise: Promise<IDBPDatabase<BagagensDatabase>> | null = null

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<BagagensDatabase>('bagagens-barretao', 2, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const passengerStore = database.createObjectStore('passengers', {
            keyPath: 'id',
          })
          passengerStore.createIndex('by-name', 'normalizedName')
          passengerStore.createIndex('by-city', 'city')
          passengerStore.createIndex('by-period', 'travelPeriod')

          const luggageStore = database.createObjectStore('luggage', {
            keyPath: 'id',
          })
          luggageStore.createIndex('by-passenger', 'passengerId')
          luggageStore.createIndex('by-code', 'normalizedCode', { unique: true })
          luggageStore.createIndex('by-stage', 'currentStage')

          const movementStore = database.createObjectStore('movements', {
            keyPath: 'id',
          })
          movementStore.createIndex('by-luggage', 'luggageId')
          movementStore.createIndex('by-date', 'occurredAt')
        }

        if (oldVersion < 2) {
          const photoStore = database.createObjectStore('photos', {
            keyPath: 'id',
          })
          photoStore.createIndex('by-passenger', 'passengerId')
          photoStore.createIndex('by-luggage', 'luggageId')
          photoStore.createIndex('by-kind', 'kind')
        }
      },
    })
  }

  return databasePromise
}
