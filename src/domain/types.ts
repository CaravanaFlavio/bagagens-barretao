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

export type CodeSource = 'MANUAL' | 'SCANNER'

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

export interface LuggageMovement {
  id: string
  luggageId: string
  type: MovementType
  fromStage: LuggageStage | null
  toStage: LuggageStage
  occurredAt: string
  note: string
}

export interface PassengerSummary extends Passenger {
  luggageCount: number
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
