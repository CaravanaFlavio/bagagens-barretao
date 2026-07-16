import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  CircleUserRound,
  Cloud,
  CloudOff,
  Database,
  FileClock,
  MapPinned,
  PackageCheck,
  PackageOpen,
  Settings,
  ShieldCheck,
  Truck,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { getDashboardSummary } from '../data/repository'
import type { DashboardSummary } from '../domain/types'

interface DashboardPageProps {
  isOnline: boolean
}

interface OperationCardProps {
  title: string
  description: string
  path: string
  icon: ReactNode
  sequence: string
  tone: 'blue' | 'red' | 'green' | 'amber'
}

const initialSummary: DashboardSummary = {
  passengerCount: 0,
  luggageCount: 0,
  pendingCount: 0,
}

export function DashboardPage({ isOnline }: DashboardPageProps) {
  const [summary, setSummary] = useState(initialSummary)

  useEffect(() => {
    void getDashboardSummary().then(setSummary)
  }, [])

  const operationCards: OperationCardProps[] = [
    {
      title: 'Galpão → carreta',
      description: 'Conferir cada volume carregado na carreta antes da saída.',
      path: '/recebimento',
      icon: <PackageOpen aria-hidden="true" />,
      sequence: '1',
      tone: 'blue',
    },
    {
      title: 'Operação em Barretos',
      description: 'Entregar e recolher por semana, com bloqueios contra leituras incorretas.',
      path: '/barretos',
      icon: <MapPinned aria-hidden="true" />,
      sequence: '2',
      tone: 'red',
    },
    {
      title: 'Retorno ao galpão',
      description: 'Conferir a carreta e separar todas as bagagens por cidade.',
      path: '/retorno',
      icon: <Truck aria-hidden="true" />,
      sequence: '3',
      tone: 'amber',
    },
    {
      title: 'Entregar às cidades',
      description: 'Transferir cada carga ao caminhão responsável pelo município.',
      path: '/entrega-cidades',
      icon: <PackageCheck aria-hidden="true" />,
      sequence: '4',
      tone: 'green',
    },
  ]

  return (
    <div className="dashboard-page">
      <section className="status-banner">
        <div className="status-banner__icon">
          {isOnline ? <Cloud aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
        </div>
        <div>
          <strong>Banco local ativo</strong>
          <p>
            Passageiros e bagagens cadastrados nesta fase ficam no banco offline do navegador de desenvolvimento.
          </p>
        </div>
      </section>

      <section aria-labelledby="resumo-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h2 id="resumo-title">Controle da operação</h2>
          </div>
          <span className="demo-tag">FASE DE TESTE</span>
        </div>

        <div className="summary-grid">
          <SummaryCard icon={<CircleUserRound />} label="Passageiros" value={String(summary.passengerCount)} />
          <SummaryCard icon={<Boxes />} label="Volumes" value={String(summary.luggageCount)} />
          <SummaryCard icon={<FileClock />} label="Pendências" value={String(summary.pendingCount)} />
          <SummaryCard icon={<Database />} label="Último backup" value="Ainda não" compact />
        </div>
      </section>

      <section aria-labelledby="operacoes-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fluxo principal</p>
            <h2 id="operacoes-title">O que você vai fazer agora?</h2>
          </div>
        </div>

        <div className="operation-grid">
          {operationCards.map((card) => (
            <OperationCard key={card.path} {...card} />
          ))}
        </div>
      </section>

      <section aria-labelledby="atalhos-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Acesso rápido</p>
            <h2 id="atalhos-title">Consultas e segurança</h2>
          </div>
        </div>

        <div className="quick-grid">
          <QuickCard title="Passageiros" description="Cadastrar e incluir bagagens" path="/passageiros" icon={<UsersRound />} badge={summary.passengerCount} />
          <QuickCard title="Pendências" description="Itens para revisar" path="/pendencias" icon={<AlertTriangle />} badge={summary.pendingCount} />
          <QuickCard title="Backup" description="Cópias e restauração" path="/backup" icon={<Cloud />} />
          <QuickCard title="Configurações" description="Cidades e setores" path="/configuracoes" icon={<Settings />} />
        </div>
      </section>

      <section className="safety-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Segurança sem labirinto</strong>
          <p>Poucas ações na tela, com código único, histórico e conferência trabalhando nos bastidores.</p>
        </div>
      </section>
    </div>
  )
}

function SummaryCard({ icon, label, value, compact = false }: { icon: ReactNode; label: string; value: string; compact?: boolean }) {
  return (
    <article className="summary-card">
      <div className="summary-card__icon" aria-hidden="true">{icon}</div>
      <div>
        <span>{label}</span>
        <strong className={compact ? 'compact-value' : undefined}>{value}</strong>
      </div>
    </article>
  )
}

function OperationCard({ title, description, path, icon, sequence, tone }: OperationCardProps) {
  return (
    <Link to={path} className={`operation-card tone-${tone}`}>
      <div className="operation-card__top">
        <span className="sequence-badge">{sequence}</span>
        <div className="operation-card__icon">{icon}</div>
      </div>
      <div className="operation-card__content">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="operation-card__footer">
        <span>Abrir operação</span>
        <ChevronRight aria-hidden="true" />
      </div>
    </Link>
  )
}

function QuickCard({ title, description, path, icon, badge }: { title: string; description: string; path: string; icon: ReactNode; badge?: number }) {
  return (
    <Link to={path} className="quick-card">
      <div className="quick-card__icon">{icon}</div>
      <div className="quick-card__content">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {badge !== undefined ? <span className="quick-card__badge">{badge}</span> : null}
      <ChevronRight className="quick-card__arrow" aria-hidden="true" />
    </Link>
  )
}
