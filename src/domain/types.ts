export type TravelPeriod = 'FIRST_WEEK' | 'SECOND_WEEK' | 'BOTH_WEEKS'

export type LuggageStage =
  | 'WAREHOUSE_INITIAL'
  | 'TRAILER_OUTBOUND'
  | 'WITH_PASSENGER'
  | 'TRAILER_RETURN'
  | 'WAREHOUSE_RETURN'

export type MovementType =
  | 'REGISTERED_AT_WAREHOUSE'
  | 'WAREHOUSE_TO_TRAILER'
  | 'TRAILER_TO_PASSENGER'
  | 'PASSENGER_TO_TRAILER'
  | 'TRAILER_TO_WAREHOUSE'

export type OperationKey =
  | 'WAREHOUSE_TO_TRAILER'
  | 'DELIVER_FIRST_WEEK'
  | 'COLLECT_FIRST_WEEK'
  | 'DELIVER_SECOND_WEEK'
  | 'COLLECT_SECOND_WEEK'
  | 'TRAILER_TO_WAREHOUSE'

export type CodeSource = 'MANUAL' | 'SCANNER'
export type PhotoKind = 'PASSENGER_SET' | 'LUGGAGE_DETAIL' | 'OPERATION_EVIDENCE'
export type OperationViewFilter = 'PENDING' | 'COMPLETED' | 'ALL'

export interface Passenger {
  id: string
  fullName: string
  normalizedName: string
  city: string
  phone: string
  travelPeriod: TravelPeriod
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Luggage {
  id: string
  passengerId: string
  code: string
  normalizedCode: string
  codeSource: CodeSource
  labelColor: string
  luggageType: string
  notes: string
  currentStage: LuggageStage
  createdAt: string
  updatedAt: string
}

export interface PhotoRecord {
  id: string
  kind: PhotoKind
  passengerId: string
  luggageId: string
  operationKey?: OperationKey
  blob: Blob
  mimeType: string
  sizeBytes: number
  width: number
  height: number
  createdAt: string
  updatedAt: string
}

export interface LuggageMovement {
  id: string
  luggageId: string
  type: MovementType
  operationKey?: OperationKey
  fromStage: LuggageStage | null
  toStage: LuggageStage
  occurredAt: string
  note: string
  photoIds?: string[]
  isException?: boolean
  exceptionReason?: string
}

export interface OperationClosure {
  id: string
  operationKey: OperationKey
  finalizedAt: string
  note: string
  completedCount: number
  remainingLuggageIds: string[]
  unexpectedLuggageIds: string[]
  passengerIdsWithoutLuggage: string[]
}

export interface PassengerSummary extends Passenger {
  luggageCount: number
  luggageStageCounts: Record<LuggageStage, number>
}

export interface DashboardSummary {
  passengerCount: number
  luggageCount: number
  pendingCount: number
}

export interface PassengerInput {
  fullName: string
  city: string
  phone: string
  travelPeriod: TravelPeriod
  notes: string
}

export interface LuggageInput {
  passengerId: string
  code: string
  codeSource: CodeSource
  labelColor: string
  luggageType: string
  notes: string
}

export interface PhotoInput {
  blob: Blob
  mimeType: string
  sizeBytes: number
  width: number
  height: number
}

export interface OperationLuggageItem extends Luggage {
  passenger: Passenger
  isPending: boolean
  isCompleted: boolean
  isUnexpected: boolean
}

export interface OperationPassengerGroup {
  passenger: Passenger
  luggage: OperationLuggageItem[]
  totalCount: number
  pendingCount: number
  completedCount: number
  unexpectedCount: number
}

export interface OperationSnapshot {
  operationKey: OperationKey
  groups: OperationPassengerGroup[]
  totalLuggage: number
  pendingLuggage: number
  completedLuggage: number
  unexpectedLuggage: number
  passengersWithoutLuggage: Passenger[]
  latestClosure?: OperationClosure
}

export type OperationScanStatus =
  | 'READY'
  | 'REQUIRES_CONFIRMATION'
  | 'ALREADY_COMPLETED'
  | 'NOT_FOUND'
  | 'BLOCKED'

export interface OperationScanCheck {
  status: OperationScanStatus
  message: string
  luggage?: Luggage
  passenger?: Passenger
}
