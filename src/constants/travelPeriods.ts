import type { TravelPeriod } from '../domain/types'

export const TRAVEL_PERIOD_LABELS: Record<TravelPeriod, string> = {
  FIRST_WEEK: '1ª semana',
  SECOND_WEEK: '2ª semana',
  BOTH_WEEKS: 'Duas semanas',
}

export const TRAVEL_PERIOD_OPTIONS: Array<{
  value: TravelPeriod
  label: string
  hint: string
}> = [
  {
    value: 'FIRST_WEEK',
    label: '1ª semana',
    hint: 'Recebe na chegada e devolve na troca das semanas.',
  },
  {
    value: 'SECOND_WEEK',
    label: '2ª semana',
    hint: 'Recebe na troca das semanas e devolve no final.',
  },
  {
    value: 'BOTH_WEEKS',
    label: 'Duas semanas',
    hint: 'Recebe na chegada e devolve somente no final.',
  },
]
