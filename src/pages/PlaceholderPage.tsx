import { CheckCircle2, House, RefreshCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface PlaceholderPageProps {
  title: string
  subtitle: string
  icon: ReactNode
  nextPhase: string
  checklist: string[]
}

export function PlaceholderPage({ title, subtitle, icon, nextPhase, checklist }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <section className="placeholder-hero">
        <div className="placeholder-hero__icon">{icon}</div>
        <div>
          <p className="eyebrow">Módulo operacional</p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </section>

      <section className="build-card">
        <div className="build-card__heading">
          <RefreshCcw aria-hidden="true" />
          <div>
            <span>Próxima fase</span>
            <h3>Estrutura funcional em preparação</h3>
          </div>
        </div>
        <p>{nextPhase}</p>
      </section>

      <section className="checklist-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fluxo previsto</p>
            <h2>O que esta tela fará</h2>
          </div>
        </div>
        <div className="checklist">
          {checklist.map((item) => (
            <div className="checklist-item" key={item}>
              <CheckCircle2 aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <Link to="/" className="primary-button">
        <House aria-hidden="true" />
        Voltar ao painel
      </Link>
    </div>
  )
}
