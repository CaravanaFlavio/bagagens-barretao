import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Luggage, LuggageMovement, Passenger, TravelPeriod, LuggageStage } from '../domain/types'

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
}

let databasePromise: Promise<IDBPDatabase<BagagensDatabase>> | null = null

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<BagagensDatabase>('bagagens-barretao', 1, {
      upgrade(database) {
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
      },
    })
  }

  return databasePromise
}
