import type {
  LuggageStage,
  MovementType,
  OperationKey,
  TravelPeriod,
} from '../domain/types'

export interface OperationDefinition {
  key: OperationKey
  title: string
  shortTitle: string
  subtitle: string
  fromStage: LuggageStage
  toStage: LuggageStage
  movementType: MovementType
  eligiblePeriods: TravelPeriod[]
  emptyPassengerWarning: boolean
  successMessage: string
}

export const OPERATION_DEFINITIONS: Record<OperationKey, OperationDefinition> = {
  WAREHOUSE_TO_TRAILER: {
    key: 'WAREHOUSE_TO_TRAILER',
    title: 'Galpão → carreta',
    shortTitle: 'Carregar a carreta',
    subtitle: 'Confirme cada volume que saiu do galpão e entrou na carreta.',
    fromStage: 'WAREHOUSE_INITIAL',
    toStage: 'TRAILER_OUTBOUND',
    movementType: 'WAREHOUSE_TO_TRAILER',
    eligiblePeriods: ['FIRST_WEEK', 'SECOND_WEEK', 'BOTH_WEEKS'],
    emptyPassengerWarning: true,
    successMessage: 'Bagagem registrada na carreta.',
  },
  DELIVER_FIRST_WEEK: {
    key: 'DELIVER_FIRST_WEEK',
    title: 'Entregar bagagens da 1ª semana',
    shortTitle: 'Entrega da 1ª semana',
    subtitle: 'Mostra apenas passageiros da primeira semana e das duas semanas.',
    fromStage: 'TRAILER_OUTBOUND',
    toStage: 'WITH_PASSENGER',
    movementType: 'TRAILER_TO_PASSENGER',
    eligiblePeriods: ['FIRST_WEEK', 'BOTH_WEEKS'],
    emptyPassengerWarning: true,
    successMessage: 'Bagagem entregue ao passageiro.',
  },
  COLLECT_FIRST_WEEK: {
    key: 'COLLECT_FIRST_WEEK',
    title: 'Recolher bagagens da 1ª semana',
    shortTitle: 'Recolhimento da 1ª semana',
    subtitle: 'Passageiros das duas semanas ficam fora desta lista e permanecem com as bagagens.',
    fromStage: 'WITH_PASSENGER',
    toStage: 'TRAILER_RETURN',
    movementType: 'PASSENGER_TO_TRAILER',
    eligiblePeriods: ['FIRST_WEEK'],
    emptyPassengerWarning: false,
    successMessage: 'Bagagem recolhida e colocada na carreta.',
  },
  DELIVER_SECOND_WEEK: {
    key: 'DELIVER_SECOND_WEEK',
    title: 'Entregar bagagens da 2ª semana',
    shortTitle: 'Entrega da 2ª semana',
    subtitle: 'Mostra somente passageiros que chegam para a segunda semana.',
    fromStage: 'TRAILER_OUTBOUND',
    toStage: 'WITH_PASSENGER',
    movementType: 'TRAILER_TO_PASSENGER',
    eligiblePeriods: ['SECOND_WEEK'],
    emptyPassengerWarning: true,
    successMessage: 'Bagagem entregue ao passageiro.',
  },
  COLLECT_SECOND_WEEK: {
    key: 'COLLECT_SECOND_WEEK',
    title: 'Recolher bagagens no fim da 2ª semana',
    shortTitle: 'Recolhimento final',
    subtitle: 'Inclui passageiros da segunda semana e os que permaneceram nas duas semanas.',
    fromStage: 'WITH_PASSENGER',
    toStage: 'TRAILER_RETURN',
    movementType: 'PASSENGER_TO_TRAILER',
    eligiblePeriods: ['SECOND_WEEK', 'BOTH_WEEKS'],
    emptyPassengerWarning: false,
    successMessage: 'Bagagem recolhida e colocada na carreta.',
  },
  TRAILER_TO_WAREHOUSE: {
    key: 'TRAILER_TO_WAREHOUSE',
    title: 'Carreta → galpão',
    shortTitle: 'Descarregar no galpão',
    subtitle: 'Confirme cada volume descarregado no retorno e preparado para separação por cidade.',
    fromStage: 'TRAILER_RETURN',
    toStage: 'WAREHOUSE_RETURN',
    movementType: 'TRAILER_TO_WAREHOUSE',
    eligiblePeriods: ['FIRST_WEEK', 'SECOND_WEEK', 'BOTH_WEEKS'],
    emptyPassengerWarning: false,
    successMessage: 'Bagagem recebida no galpão de retorno.',
  },
}

export const STAGE_LABELS: Record<LuggageStage, string> = {
  WAREHOUSE_INITIAL: 'No galpão',
  TRAILER_OUTBOUND: 'Na carreta de ida',
  WITH_PASSENGER: 'Com o passageiro',
  TRAILER_RETURN: 'Na carreta de retorno',
  WAREHOUSE_RETURN: 'No galpão de retorno',
  DELIVERED_TO_CITY: 'Entregue à cidade',
}

export const OPERATION_ROUTES: Record<OperationKey, string> = {
  WAREHOUSE_TO_TRAILER: '/recebimento',
  DELIVER_FIRST_WEEK: '/barretos/entrega-primeira',
  COLLECT_FIRST_WEEK: '/barretos/recolhimento-primeira',
  DELIVER_SECOND_WEEK: '/barretos/entrega-segunda',
  COLLECT_SECOND_WEEK: '/barretos/recolhimento-segunda',
  TRAILER_TO_WAREHOUSE: '/retorno',
}
