import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  ChevronRight,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { Link } from 'react-router'
import { OPERATION_DEFINITIONS, OPERATION_ROUTES } from '../constants/operations'
import type { OperationKey } from '../domain/types'

const operations: Array<{
  key: OperationKey
  step: string
  tone: 'blue' | 'red' | 'green' | 'amber'
  icon: typeof ArrowDownToLine
  note: string
}> = [
  {
    key: 'DELIVER_FIRST_WEEK',
    step: '1',
    tone: 'blue',
    icon: ArrowDownToLine,
    note: '1ª semana + duas semanas',
  },
  {
    key: 'COLLECT_FIRST_WEEK',
    step: '2',
    tone: 'amber',
    icon: ArrowUpFromLine,
    note: 'Somente 1ª semana',
  },
  {
    key: 'DELIVER_SECOND_WEEK',
    step: '3',
    tone: 'red',
    icon: ArrowDownToLine,
    note: 'Somente 2ª semana',
  },
  {
    key: 'COLLECT_SECOND_WEEK',
    step: '4',
    tone: 'green',
    icon: ArrowUpFromLine,
    note: '2ª semana + duas semanas',
  },
]

export function BarretosPage() {
  return (
    <div className="operation-hub-page">
      <section className="page-title-card operation-hub-title">
        <div>
          <p className="eyebrow">Fluxo por semana</p>
          <h2>Operação em Barretos</h2>
          <p>Abra somente a etapa que está acontecendo agora. A lista já virá filtrada para os passageiros corretos.</p>
        </div>
        <div className="operation-hub-title__icon" aria-hidden="true">
          <CalendarDays />
        </div>
      </section>

      <section className="barretos-rule-card">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Passageiros das duas semanas</strong>
          <p>Recebem as bagagens na primeira entrega e aparecem novamente apenas no recolhimento final.</p>
        </div>
      </section>

      <section className="barretos-operation-grid">
        {operations.map(({ key, step, tone, icon: Icon, note }) => {
          const definition = OPERATION_DEFINITIONS[key]
          return (
            <Link
              key={key}
              to={OPERATION_ROUTES[key]}
              className={`barretos-operation-card tone-${tone}`}
            >
              <div className="barretos-operation-card__top">
                <span className="sequence-badge">{step}</span>
                <div className="operation-card__icon"><Icon aria-hidden="true" /></div>
              </div>
              <div>
                <span className="barretos-operation-card__note">{note}</span>
                <h3>{definition.shortTitle}</h3>
                <p>{definition.subtitle}</p>
              </div>
              <div className="operation-card__footer">
                <span>Abrir conferência</span>
                <ChevronRight aria-hidden="true" />
              </div>
            </Link>
          )
        })}
      </section>

      <section className="safety-note">
        <UsersRound aria-hidden="true" />
        <div>
          <strong>Uma lista menor de cada vez</strong>
          <p>O padrão mostra somente quem ainda tem bagagem pendente naquela etapa.</p>
        </div>
      </section>
    </div>
  )
}
