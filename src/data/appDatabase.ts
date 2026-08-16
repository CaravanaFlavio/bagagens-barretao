import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  CityTransfer,
  CityTransferStatus,
  Luggage,
  LuggageMovement,
  LuggageStage,
  OperationClosure,
  OperationKey,
  Passenger,
  PassengerImportBatch,
  PhotoKind,
  PhotoRecord,
  SetReconciliation,
  SetReconciliationOperationKey,
  TravelPeriod,
  UnidentifiedLuggage,
  UnidentifiedLuggageStatus,
} from '../domain/types'

export interface BagagensDatabase extends DBSchema {
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
  operationClosures: {
    key: string
    value: OperationClosure
    indexes: {
      'by-operation': OperationKey
      'by-date': string
    }
  }
  cityTransfers: {
    key: string
    value: CityTransfer
    indexes: {
      'by-city': string
      'by-status': CityTransferStatus
      'by-date': string
    }
  }

  appMetadata: {
    key: string
    value: {
      key: string
      value: string
      updatedAt: string
    }
  }
  passengerImportBatches: {
    key: string
    value: PassengerImportBatch
    indexes: {
      'by-date': string
      'by-fingerprint': string
    }
  }


  unidentifiedLuggage: {
    key: string
    value: UnidentifiedLuggage
    indexes: {
      'by-status': UnidentifiedLuggageStatus
      'by-date': string
    }
  }
  setReconciliations: {
    key: string
    value: SetReconciliation
    indexes: {
      'by-passenger': string
      'by-operation': SetReconciliationOperationKey
      'by-date': string
    }
  }
}

export const BAGAGENS_DATABASE_VERSION = 8

let databasePromise: Promise<IDBPDatabase<BagagensDatabase>> | null = null

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<BagagensDatabase>('bagagens-barretao', BAGAGENS_DATABASE_VERSION, {
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

        if (oldVersion < 3) {
          const closureStore = database.createObjectStore('operationClosures', {
            keyPath: 'id',
          })
          closureStore.createIndex('by-operation', 'operationKey')
          closureStore.createIndex('by-date', 'finalizedAt')
        }

        if (oldVersion < 4) {
          const transferStore = database.createObjectStore('cityTransfers', {
            keyPath: 'id',
          })
          transferStore.createIndex('by-city', 'city')
          transferStore.createIndex('by-status', 'status')
          transferStore.createIndex('by-date', 'updatedAt')
        }

        if (oldVersion < 5) {
          database.createObjectStore('appMetadata', {
            keyPath: 'key',
          })
        }

        if (oldVersion < 6) {
          const importBatchStore = database.createObjectStore('passengerImportBatches', {
            keyPath: 'id',
          })
          importBatchStore.createIndex('by-date', 'importedAt')
          importBatchStore.createIndex('by-fingerprint', 'fingerprint', { unique: true })
        }

        if (oldVersion < 7) {
          const unidentifiedStore = database.createObjectStore('unidentifiedLuggage', {
            keyPath: 'id',
          })
          unidentifiedStore.createIndex('by-status', 'status')
          unidentifiedStore.createIndex('by-date', 'foundAt')
        }

        if (oldVersion < 8) {
          const reconciliationStore = database.createObjectStore('setReconciliations', {
            keyPath: 'id',
          })
          reconciliationStore.createIndex('by-passenger', 'passengerId')
          reconciliationStore.createIndex('by-operation', 'operationKey')
          reconciliationStore.createIndex('by-date', 'checkedAt')
        }
      },
    })
  }

  return databasePromise
}
