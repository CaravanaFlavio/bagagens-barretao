export type TravelPeriod = 'FIRST_WEEK' | 'SECOND_WEEK' | 'BOTH_WEEKS'

export type LuggageStage =
  | 'WAREHOUSE_INITIAL'
  | 'TRAILER_OUTBOUND'
  | 'WITH_PASSENGER'
  | 'TRAILER_RETURN'
  | 'WAREHOUSE_RETURN'
  | 'DELIVERED_TO_CITY'

export type MovementType =
  | 'REGISTERED_AT_WAREHOUSE'
  | 'WAREHOUSE_TO_TRAILER'
  | 'TRAILER_TO_PASSENGER'
  | 'PASSENGER_TO_TRAILER'
  | 'TRAILER_TO_WAREHOUSE'
  | 'WAREHOUSE_TO_CITY'

export type OperationKey =
  | 'WAREHOUSE_TO_TRAILER'
  | 'DELIVER_FIRST_WEEK'
  | 'COLLECT_FIRST_WEEK'
  | 'DELIVER_SECOND_WEEK'
  | 'COLLECT_SECOND_WEEK'
  | 'TRAILER_TO_WAREHOUSE'

export type CodeSource = 'MANUAL' | 'SCANNER'
export type PhotoKind = 'PASSENGER_SET' | 'LUGGAGE_DETAIL' | 'OPERATION_EVIDENCE'
export type OperationViewFilter = 'PENDING' | 'COMPLETED' | 'UNEXPECTED' | 'ALL'
export type CityTransferStatus = 'DRAFT' | 'FINALIZED'

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
  cityTransferId?: string
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

export interface CityTransfer {
  id: string
  city: string
  status: CityTransferStatus
  responsibleName: string
  vehicleDescription: string
  vehiclePlate: string
  note: string
  scannedLuggageIds: string[]
  expectedLuggageIds: string[]
  missingLuggageIds: string[]
  issueNote: string
  startedAt: string
  updatedAt: string
  finalizedAt?: string
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

export type CityTransferScanStatus =
  | 'READY'
  | 'ALREADY_SCANNED'
  | 'ALREADY_DELIVERED'
  | 'WRONG_CITY'
  | 'NOT_READY'
  | 'NOT_FOUND'
  | 'BLOCKED'

export interface CityTransferScanCheck {
  status: CityTransferScanStatus
  message: string
  luggage?: Luggage
  passenger?: Passenger
}

export interface CityDeliverySummary {
  city: string
  passengerCount: number
  luggageCount: number
  readyCount: number
  deliveredCount: number
  notReadyCount: number
  draftScannedCount: number
  latestTransfer?: CityTransfer
}

export interface CityDeliveryOverview {
  generatedAt: string
  cities: CityDeliverySummary[]
  finalizedTransfers: CityTransfer[]
}

export interface CityTransferWorkspace {
  transfer: CityTransfer
  city: string
  passengerCount: number
  luggage: LuggageReportItem[]
  totalCount: number
  readyCount: number
  scannedCount: number
  notReadyCount: number
  deliveredCount: number
}

export interface CityTransferDetailsInput {
  responsibleName: string
  vehicleDescription: string
  vehiclePlate: string
  note: string
}

export interface CityTransferReceiptItem {
  luggage: Luggage
  passenger: Passenger
}

export interface CityTransferReceipt {
  transfer: CityTransfer
  items: CityTransferReceiptItem[]
  missingItems: CityTransferReceiptItem[]
}

export type CentralPendencyKind =
  | 'PASSENGER_WITHOUT_LUGGAGE'
  | 'MOVEMENT_EXCEPTION'
  | 'CLOSURE_DIVERGENCE'
  | 'CITY_TRANSFER_DIVERGENCE'

export interface CentralPendency {
  id: string
  kind: CentralPendencyKind
  occurredAt: string
  passenger?: Passenger
  luggage?: Luggage
  movement?: LuggageMovement
  closure?: OperationClosure
  cityTransfer?: CityTransfer
}

export interface LuggageReportItem extends Luggage {
  passenger: Passenger
  latestMovement?: LuggageMovement
}

export interface MovementReportItem {
  movement: LuggageMovement
  luggage: Luggage
  passenger: Passenger
}

export interface CityReportSummary {
  city: string
  passengerCount: number
  luggageCount: number
  stageCounts: Record<LuggageStage, number>
}

export interface PeriodReportSummary {
  travelPeriod: TravelPeriod
  passengerCount: number
  luggageCount: number
  stageCounts: Record<LuggageStage, number>
}

export interface PendenciesReport {
  generatedAt: string
  passengerCount: number
  luggageCount: number
  passengerWithoutLuggageCount: number
  exceptionCount: number
  divergentClosureCount: number
  activePendencyCount: number
  stageCounts: Record<LuggageStage, number>
  pendencies: CentralPendency[]
  luggage: LuggageReportItem[]
  movementTimeline: MovementReportItem[]
  closures: OperationClosure[]
  citySummaries: CityReportSummary[]
  periodSummaries: PeriodReportSummary[]
}

export interface ContingencyLuggageRow {
  luggage: Luggage
  passenger: Passenger
  movements: LuggageMovement[]
  cityTransfer?: CityTransfer
}

export interface ContingencyPassengerRow {
  passenger: Passenger
  luggageCount: number
}

export interface ContingencySnapshot {
  generatedAt: string
  latestDataAt: string
  passengerCount: number
  luggageCount: number
  passengers: ContingencyPassengerRow[]
  luggageRows: ContingencyLuggageRow[]
  citySummaries: CityReportSummary[]
  periodSummaries: PeriodReportSummary[]
}
