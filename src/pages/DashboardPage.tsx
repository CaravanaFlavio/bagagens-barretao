import {
  AlertTriangle,
  Barcode,
  Boxes,
  Camera,
  ChevronRight,
  CircleUserRound,
  Cloud,
  CloudOff,
  Database,
  FileClock,
  FileSpreadsheet,
  LoaderCircle,
  MapPinned,
  PackageCheck,
  PackageOpen,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { Modal } from '../components/Modal'
import { STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import {
  findLuggageByCodeWithPassenger,
  findLuggageByIdWithPassenger,
  getDashboardSummary,
  getPassengerById,
} from '../data/repository'
import type { DashboardSummary, Luggage, Passenger } from '../domain/types'
import { parseOperationalQr } from '../utils/operationalQr'
import { getBackupOverview } from '../data/backupService'

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

type ScannerResult =
  | { kind: 'PASSENGER'; passenger: Passenger }
  | { kind: 'LUGGAGE'; passenger: Passenger; luggage: Luggage }

const initialSummary: DashboardSummary = {
  passengerCount: 0,
  luggageCount: 0,
  pendingCount: 0,
  passengerReviewCount: 0,
  unidentifiedLuggageCount: 0,
}

const DOCUMENT_TYPE_LABELS = {
  CPF: 'CPF',
  RG: 'RG',
  UNKNOWN: 'Documento',
} as const

const BUS_TYPE_LABELS = {
  DOUBLE_DECKER: 'Ônibus 2 andares',
  CONVENTIONAL: 'Ônibus convencional',
  UNSPECIFIED: 'Ônibus não informado',
} as const


function formatBackupTime(value?: string) {
  if (!value) return 'Ainda não'
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function DashboardPage({ isOnline }: DashboardPageProps) {
  const [summary, setSummary] = useState(initialSummary)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerCode, setScannerCode] = useState('')
  const [scannerBusy, setScannerBusy] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const [scannerResult, setScannerResult] = useState<ScannerResult | null>(null)
  const [lastBackupAt, setLastBackupAt] = useState<string | undefined>()

  useEffect(() => {
    void Promise.all([
      getDashboardSummary(),
      getBackupOverview(),
    ]).then(([dashboardSummary, backupOverview]) => {
      setSummary(dashboardSummary)
      setLastBackupAt(backupOverview.lastBackupAt)
    })
  }, [])

  const resolveCode = useCallback(async (rawValue: string) => {
    const value = rawValue.trim()
    if (!value) {
      setScannerError('Digite ou escaneie um código.')
      return
    }

    try {
      setScannerBusy(true)
      setScannerError('')
      setScannerResult(null)

      const payload = parseOperationalQr(value)

      if (payload.kind === 'PASSENGER') {
        const passenger = await getPassengerById(payload.id)
        if (!passenger) throw new Error('Passageiro não encontrado para este QR Code.')
        setScannerResult({ kind: 'PASSENGER', passenger })
        return
      }

      const match = payload.kind === 'LUGGAGE'
        ? await findLuggageByIdWithPassenger(payload.id)
        : await findLuggageByCodeWithPassenger(payload.code)

      if (!match) {
        throw new Error(
          payload.kind === 'EXTERNAL_CODE'
            ? `Nenhuma bagagem cadastrada com o código ${value}.`
            : 'Bagagem não encontrada para este QR Code.',
        )
      }

      setScannerResult({ kind: 'LUGGAGE', ...match })
    } catch (error) {
      setScannerError(error instanceof Error ? error.message : 'Não foi possível localizar o código.')
    } finally {
      setScannerBusy(false)
    }
  }, [])

  const handleDetected = useCallback((code: string) => {
    setScannerOpen(false)
    const payload = parseOperationalQr(code)
    setScannerCode(
      payload.kind === 'EXTERNAL_CODE'
        ? payload.code
        : payload.kind === 'PASSENGER'
          ? 'QR do passageiro'
          : 'QR do volume',
    )
    void resolveCode(code)
  }, [resolveCode])

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
        <div className="section-heading dashboard-control-heading">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h2 id="resumo-title">Controle da operação</h2>
          </div>
          <span className="demo-tag">FASE DE TESTE</span>
        </div>

        <div className="dashboard-scanner-card">
          <div className="dashboard-scanner-card__intro">
            <div className="dashboard-scanner-card__icon">
              <Barcode aria-hidden="true" />
            </div>
            <div>
              <strong>Scanner rápido</strong>
              <span>Leia QR de passageiro, QR reserva ou o QR/código do lacre.</span>
            </div>
          </div>

          <div className="dashboard-scanner-card__actions">
            <input
              value={scannerCode}
              onChange={(event) => setScannerCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void resolveCode(scannerCode)
              }}
              placeholder="Digite o código, ex.: 0001"
              aria-label="Código para localizar"
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setScannerError('')
                setScannerOpen(true)
              }}
            >
              <Barcode aria-hidden="true" />
              Escanear
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void resolveCode(scannerCode)}
              disabled={scannerBusy}
            >
              {scannerBusy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              Buscar
            </button>
          </div>

          {scannerError ? <div className="dashboard-scanner-error">{scannerError}</div> : null}
        </div>

        <div className="summary-grid">
          <SummaryCard icon={<CircleUserRound />} label="Passageiros" value={String(summary.passengerCount)} />
          <SummaryCard icon={<Boxes />} label="Volumes" value={String(summary.luggageCount)} />
          <SummaryCard icon={<FileClock />} label="Pendências" value={String(summary.pendingCount)} />
          <SummaryCard icon={<Database />} label="Último backup" value={formatBackupTime(lastBackupAt)} compact />
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
          <QuickCard
            title="Revisar cadastros"
            description="Duplicidades e dados a confirmar"
            path="/passageiros?revisar=1"
            icon={<AlertTriangle />}
            badge={summary.passengerReviewCount > 0 ? summary.passengerReviewCount : undefined}
            warning={summary.passengerReviewCount > 0}
          />
          <QuickCard title="Pendências" description="Pendências do fluxo de bagagens" path="/pendencias" icon={<AlertTriangle />} badge={summary.pendingCount} />
          <QuickCard title="Contingência" description="Planilha para controle manual" path="/contingencia" icon={<FileSpreadsheet />} />
          <QuickCard
            title="Achados / Sem identificação"
            description="Fotografar agora e vincular ao dono depois"
            path="/achados"
            icon={<PackageOpen />}
            badge={summary.unidentifiedLuggageCount > 0 ? summary.unidentifiedLuggageCount : undefined}
            warning={summary.unidentifiedLuggageCount > 0}
          />
          <QuickCard title="Relatório fotográfico" description="Fotos dos conjuntos por passageiro" path="/relatorio-fotografico" icon={<Camera />} />
          <QuickCard title="Placas por cidade" description="A4 por cidade e semana" path="/placas-cidades" icon={<MapPinned />} />
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

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleDetected}
      />

      <Modal
        open={Boolean(scannerResult)}
        title={scannerResult?.kind === 'LUGGAGE' ? 'Bagagem localizada' : 'Passageiro localizado'}
        subtitle="Consulta feita no banco local do aparelho, sem depender de internet."
        onClose={() => setScannerResult(null)}
      >
        {scannerResult ? (
          <div className="dashboard-scan-result">
            <header>
              <span>{scannerResult.kind === 'LUGGAGE' ? `Código ${scannerResult.luggage.code}` : 'Passageiro'}</span>
              <h3>{scannerResult.passenger.fullName}</h3>
            </header>

            <dl>
              <div>
                <dt>Cidade</dt>
                <dd>{scannerResult.passenger.city}</dd>
              </div>
              <div>
                <dt>Período</dt>
                <dd>{TRAVEL_PERIOD_LABELS[scannerResult.passenger.travelPeriod]}</dd>
              </div>
              <div>
                <dt>Ônibus</dt>
                <dd>{BUS_TYPE_LABELS[scannerResult.passenger.busType]}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{scannerResult.passenger.phone || 'Não informado'}</dd>
              </div>
              <div>
                <dt>Documento</dt>
                <dd>
                  {scannerResult.passenger.documentNumber
                    ? `${DOCUMENT_TYPE_LABELS[scannerResult.passenger.documentType]}: ${scannerResult.passenger.documentNumber}`
                    : 'Não informado'}
                </dd>
              </div>
              <div>
                <dt>Cadastro</dt>
                <dd>{scannerResult.passenger.reviewStatus === 'REVIEW' ? 'Precisa revisar' : 'Confirmado'}</dd>
              </div>

              {scannerResult.kind === 'LUGGAGE' ? (
                <>
                  <div>
                    <dt>Tipo do volume</dt>
                    <dd>{scannerResult.luggage.luggageType}</dd>
                  </div>
                  <div>
                    <dt>Cor da etiqueta/lacre</dt>
                    <dd>{scannerResult.luggage.labelColor || 'Não informada'}</dd>
                  </div>
                  <div>
                    <dt>Situação atual</dt>
                    <dd>{STAGE_LABELS[scannerResult.luggage.currentStage]}</dd>
                  </div>
                </>
              ) : null}
            </dl>

            {scannerResult.passenger.notes ? (
              <div className="dashboard-scan-note">
                <strong>Observação do passageiro</strong>
                <p>{scannerResult.passenger.notes}</p>
              </div>
            ) : null}

            {scannerResult.kind === 'LUGGAGE' && scannerResult.luggage.notes ? (
              <div className="dashboard-scan-note">
                <strong>Observação da bagagem</strong>
                <p>{scannerResult.luggage.notes}</p>
              </div>
            ) : null}

            {scannerResult.passenger.importWarning ? (
              <div className="dashboard-scan-warning">
                <AlertTriangle aria-hidden="true" />
                <div>
                  <strong>Alerta do cadastro</strong>
                  <p>{scannerResult.passenger.importWarning}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
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

function QuickCard({
  title,
  description,
  path,
  icon,
  badge,
  warning = false,
}: {
  title: string
  description: string
  path: string
  icon: ReactNode
  badge?: number
  warning?: boolean
}) {
  return (
    <Link to={path} className={`quick-card ${warning ? 'quick-card--warning' : ''}`}>
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
