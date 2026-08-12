import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileClock,
  History,
  LoaderCircle,
  MapPin,
  Printer,
  RefreshCcw,
  Search,
  ShieldAlert,
  Truck,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Modal } from '../components/Modal'
import { CITIES } from '../constants/cities'
import { OPERATION_DEFINITIONS, STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import {
  getPendenciesReport,
  getPhotosByIds,
  listLuggageMovements,
} from '../data/repository'
import type {
  CentralPendency,
  LuggageMovement,
  LuggageReportItem,
  LuggageStage,
  PendenciesReport,
  PhotoRecord,
} from '../domain/types'

type ReportTab = 'PENDENCIES' | 'LUGGAGE' | 'CLOSURES' | 'TOTALS'

const MOVEMENT_LABELS: Record<LuggageMovement['type'], string> = {
  REGISTERED_AT_WAREHOUSE: 'Recebida no galpão',
  WAREHOUSE_TO_TRAILER: 'Galpão → carreta',
  TRAILER_TO_PASSENGER: 'Carreta → passageiro',
  PASSENGER_TO_TRAILER: 'Passageiro → carreta',
  TRAILER_TO_WAREHOUSE: 'Carreta → galpão',
  WAREHOUSE_TO_CITY: 'Galpão → cidade',
}

const STAGE_OPTIONS = Object.entries(STAGE_LABELS) as [LuggageStage, string][]

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleUpperCase('pt-BR')
}

function operationTitle(operationKey: keyof typeof OPERATION_DEFINITIONS | undefined) {
  return operationKey ? OPERATION_DEFINITIONS[operationKey].shortTitle : 'Operação'
}

function buildPrintDocumentTitle(generatedAt: string) {
  const date = new Date(generatedAt)
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  const timePart = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('')
  return `Relatorio_Operacional_Bagagens_${datePart}_${timePart}`
}

function movementRoute(movement: LuggageMovement) {
  const from = movement.fromStage
    ? STAGE_LABELS[movement.fromStage]
    : 'Entrada no sistema'
  return `${from} → ${STAGE_LABELS[movement.toStage]}`
}

export function PendenciesPage() {
  const [report, setReport] = useState<PendenciesReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeTab, setActiveTab] = useState<ReportTab>('PENDENCIES')
  const [query, setQuery] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [stageFilter, setStageFilter] = useState<LuggageStage | ''>('')

  const [historyTarget, setHistoryTarget] = useState<LuggageReportItem | null>(null)
  const [historyMovements, setHistoryMovements] = useState<LuggageMovement[]>([])
  const [historyPhotos, setHistoryPhotos] = useState<PhotoRecord[]>([])
  const historyPhotoUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    for (const photo of historyPhotos) {
      urls[photo.id] = URL.createObjectURL(photo.blob)
    }
    return urls
  }, [historyPhotos])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [photoViewer, setPhotoViewer] = useState<{ title: string; url: string } | null>(null)

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage('')
      setReport(await getPendenciesReport())
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a Central de Pendências.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadReport()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadReport])

  useEffect(() => {
    return () => Object.values(historyPhotoUrls).forEach((url) => URL.revokeObjectURL(url))
  }, [historyPhotoUrls])

  const normalizedQuery = useMemo(() => normalizeSearch(query), [query])

  const visiblePendencies = useMemo(() => {
    if (!report) return []
    return report.pendencies.filter((item) => {
      const passenger = item.passenger
      const luggage = item.luggage
      const matchesCity = !cityFilter || passenger?.city === cityFilter
      const searchable = normalizeSearch(
        [
          passenger?.fullName,
          passenger?.city,
          passenger?.phone,
          luggage?.code,
          luggage?.labelColor,
          item.movement?.exceptionReason,
          item.closure?.note,
          item.closure ? operationTitle(item.closure.operationKey) : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
      return matchesCity && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [cityFilter, normalizedQuery, report])

  const visibleLuggage = useMemo(() => {
    if (!report) return []
    return report.luggage.filter((item) => {
      const matchesCity = !cityFilter || item.passenger.city === cityFilter
      const matchesStage = !stageFilter || item.currentStage === stageFilter
      const searchable = normalizeSearch(
        [
          item.code,
          item.passenger.fullName,
          item.passenger.city,
          item.passenger.phone,
          item.labelColor,
          item.luggageType,
        ].join(' '),
      )
      return (
        matchesCity &&
        matchesStage &&
        (!normalizedQuery || searchable.includes(normalizedQuery))
      )
    })
  }, [cityFilter, normalizedQuery, report, stageFilter])

  const openHistory = async (item: LuggageReportItem) => {
    try {
      setHistoryTarget(item)
      setHistoryLoading(true)
      const movements = await listLuggageMovements(item.id)
      const photoIds = Array.from(
        new Set(movements.flatMap((movement) => movement.photoIds ?? [])),
      )
      setHistoryMovements(movements)
      setHistoryPhotos(await getPhotosByIds(photoIds))
    } finally {
      setHistoryLoading(false)
    }
  }

  const closeHistory = () => {
    setHistoryTarget(null)
    setHistoryMovements([])
    setHistoryPhotos([])
  }

  const handlePrint = () => {
    const previousTitle = document.title
    const restoreTitle = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restoreTitle)
    }

    document.title = buildPrintDocumentTitle(report?.generatedAt ?? new Date().toISOString())
    window.addEventListener('afterprint', restoreTitle)
    window.requestAnimationFrame(() => window.print())
    window.setTimeout(restoreTitle, 60_000)
  }

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" aria-hidden="true" />
        Carregando pendências e relatórios...
      </div>
    )
  }

  if (!report) {
    return <div className="alert alert--danger">{errorMessage || 'Relatório indisponível.'}</div>
  }

  return (
    <div className="pendencies-page">
      <section className="page-title-card report-title-card">
        <div>
          <p className="eyebrow">Radar da operação</p>
          <h2>Pendências e relatórios</h2>
          <p>Veja rapidamente o que exige atenção e onde está cada bagagem.</p>
        </div>
        <div className="report-actions">
          <button type="button" className="secondary-button" onClick={() => void loadReport()}>
            <RefreshCcw aria-hidden="true" />
            Atualizar
          </button>
          <button type="button" className="primary-button" onClick={handlePrint}>
            <Printer aria-hidden="true" />
            Imprimir
          </button>
        </div>
      </section>

      {errorMessage ? <div className="alert alert--danger">{errorMessage}</div> : null}

      <section className="report-summary-grid">
        <ReportSummaryCard
          label="Passageiros sem bagagem"
          value={report.passengerWithoutLuggageCount}
          icon={<UserRound />}
          tone="amber"
        />
        <ReportSummaryCard
          label="Exceções registradas"
          value={report.exceptionCount}
          icon={<ShieldAlert />}
          tone="red"
        />
        <ReportSummaryCard
          label="Fechamentos divergentes"
          value={report.divergentClosureCount}
          icon={<FileClock />}
          tone="amber"
        />
        <ReportSummaryCard
          label="Volumes cadastrados"
          value={report.luggageCount}
          icon={<BriefcaseBusiness />}
          tone="blue"
        />
      </section>

      <section className="report-location-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Localização atual</p>
            <h2>Onde estão as bagagens</h2>
          </div>
          <time>Atualizado em {formatDateTime(report.generatedAt)}</time>
        </div>
        <div className="report-stage-grid">
          {STAGE_OPTIONS.map(([stage, label]) => (
            <article className={`report-stage-item stage-${stage.toLowerCase()}`} key={stage}>
              <span>{label}</span>
              <strong>{report.stageCounts[stage]}</strong>
            </article>
          ))}
        </div>
      </section>

      <nav className="report-tabs" aria-label="Seções do relatório">
        <ReportTabButton active={activeTab === 'PENDENCIES'} onClick={() => setActiveTab('PENDENCIES')}>
          Pendências <span>{report.pendencies.length}</span>
        </ReportTabButton>
        <ReportTabButton active={activeTab === 'LUGGAGE'} onClick={() => setActiveTab('LUGGAGE')}>
          Bagagens <span>{report.luggage.length}</span>
        </ReportTabButton>
        <ReportTabButton active={activeTab === 'CLOSURES'} onClick={() => setActiveTab('CLOSURES')}>
          Fechamentos <span>{report.closures.length}</span>
        </ReportTabButton>
        <ReportTabButton active={activeTab === 'TOTALS'} onClick={() => setActiveTab('TOTALS')}>
          Totais
        </ReportTabButton>
      </nav>

      {(activeTab === 'PENDENCIES' || activeTab === 'LUGGAGE') ? (
        <section className="report-filter-card">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome, cidade ou código do lacre"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa">
                <X aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <label className="select-field">
            <MapPin aria-hidden="true" />
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="">Todas as cidades</option>
              {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          {activeTab === 'LUGGAGE' ? (
            <label className="select-field">
              <BriefcaseBusiness aria-hidden="true" />
              <select
                value={stageFilter}
                onChange={(event) => setStageFilter(event.target.value as LuggageStage | '')}
              >
                <option value="">Todas as localizações</option>
                {STAGE_OPTIONS.map(([stage, label]) => (
                  <option key={stage} value={stage}>{label}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </label>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'PENDENCIES' ? (
        <section className="report-tab-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Itens para revisar</p>
              <h2>{visiblePendencies.length} alertas encontrados</h2>
            </div>
          </div>
          {visiblePendencies.length === 0 ? (
            <section className="empty-state report-empty-state">
              <CheckCircle2 aria-hidden="true" />
              <h3>Nenhuma pendência neste filtro</h3>
              <p>A operação está respirando tranquila por aqui.</p>
            </section>
          ) : (
            <div className="pendency-list">
              {visiblePendencies.map((item) => <PendencyCard item={item} key={item.id} />)}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'LUGGAGE' ? (
        <section className="report-tab-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Rastreamento</p>
              <h2>{visibleLuggage.length} bagagens exibidas</h2>
            </div>
          </div>
          {visibleLuggage.length === 0 ? (
            <section className="empty-state report-empty-state">
              <BriefcaseBusiness aria-hidden="true" />
              <h3>Nenhuma bagagem neste filtro</h3>
              <p>Altere a pesquisa, a cidade ou a localização.</p>
            </section>
          ) : (
            <div className="report-luggage-list">
              {visibleLuggage.map((item) => (
                <article className="report-luggage-card" key={item.id}>
                  <div className="report-luggage-card__code">
                    <BriefcaseBusiness aria-hidden="true" />
                    <div>
                      <strong>{item.code}</strong>
                      <span>{item.luggageType} · {item.labelColor}</span>
                    </div>
                  </div>
                  <div className="report-luggage-card__owner">
                    <strong>{item.passenger.fullName}</strong>
                    <span>{item.passenger.city} · {TRAVEL_PERIOD_LABELS[item.passenger.travelPeriod]}</span>
                  </div>
                  <span className={`luggage-current-stage stage-${item.currentStage.toLowerCase()}`}>
                    {STAGE_LABELS[item.currentStage]}
                  </span>
                  <div className="report-luggage-card__footer">
                    <small>
                      Último registro: {formatDateTime(item.latestMovement?.occurredAt ?? item.updatedAt)}
                    </small>
                    <button type="button" className="mini-action-button" onClick={() => void openHistory(item)}>
                      <History aria-hidden="true" />
                      <span>Histórico</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'CLOSURES' ? (
        <section className="report-tab-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Conferências encerradas</p>
              <h2>Histórico de fechamentos</h2>
            </div>
          </div>
          {report.closures.length === 0 ? (
            <section className="empty-state report-empty-state">
              <FileClock aria-hidden="true" />
              <h3>Nenhuma etapa finalizada</h3>
              <p>Os fechamentos aparecerão aqui depois da primeira conferência.</p>
            </section>
          ) : (
            <div className="closure-list">
              {report.closures.map((closure) => {
                const hasIssues =
                  closure.remainingLuggageIds.length > 0 ||
                  closure.unexpectedLuggageIds.length > 0 ||
                  closure.passengerIdsWithoutLuggage.length > 0
                return (
                  <article className={`closure-card ${hasIssues ? 'has-issues' : 'is-clear'}`} key={closure.id}>
                    <div className="closure-card__header">
                      {hasIssues ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                      <div>
                        <strong>{operationTitle(closure.operationKey)}</strong>
                        <time>{formatDateTime(closure.finalizedAt)}</time>
                      </div>
                    </div>
                    <div className="closure-card__numbers">
                      <span><strong>{closure.completedCount}</strong> conferidas</span>
                      <span><strong>{closure.remainingLuggageIds.length}</strong> restantes</span>
                      <span><strong>{closure.unexpectedLuggageIds.length}</strong> fora do fluxo</span>
                      <span><strong>{closure.passengerIdsWithoutLuggage.length}</strong> sem bagagem</span>
                    </div>
                    <p>{closure.note || 'Finalizada sem observações.'}</p>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'TOTALS' ? (
        <section className="report-tab-panel totals-panel">
          <div>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Por período</p>
                <h2>Passageiros e bagagens</h2>
              </div>
            </div>
            <div className="period-total-grid">
              {report.periodSummaries.map((summary) => (
                <article className="period-total-card" key={summary.travelPeriod}>
                  <strong>{TRAVEL_PERIOD_LABELS[summary.travelPeriod]}</strong>
                  <div><span>Passageiros</span><b>{summary.passengerCount}</b></div>
                  <div><span>Bagagens</span><b>{summary.luggageCount}</b></div>
                  <small>{summary.stageCounts.WAREHOUSE_RETURN + summary.stageCounts.DELIVERED_TO_CITY} já retornaram ao galpão · {summary.stageCounts.DELIVERED_TO_CITY} entregues à cidade</small>
                </article>
              ))}
            </div>
          </div>

          <div>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Por município</p>
                <h2>Totais das cidades</h2>
              </div>
            </div>
            <div className="city-report-table-wrap">
              <table className="city-report-table city-report-table--stages">
                <thead>
                  <tr>
                    <th>Cidade</th>
                    <th>Passageiros</th>
                    <th>Bagagens</th>
                    <th>No galpão</th>
                    <th>Carreta ida</th>
                    <th>Com passageiro</th>
                    <th>Carreta retorno</th>
                    <th>Galpão retorno</th>
                    <th>Entregues à cidade</th>
                  </tr>
                </thead>
                <tbody>
                  {report.citySummaries.map((summary) => (
                    <tr key={summary.city}>
                      <td>{summary.city}</td>
                      <td>{summary.passengerCount}</td>
                      <td>{summary.luggageCount}</td>
                      <td>{summary.stageCounts.WAREHOUSE_INITIAL}</td>
                      <td>{summary.stageCounts.TRAILER_OUTBOUND}</td>
                      <td>{summary.stageCounts.WITH_PASSENGER}</td>
                      <td>{summary.stageCounts.TRAILER_RETURN}</td>
                      <td>{summary.stageCounts.WAREHOUSE_RETURN}</td>
                      <td>{summary.stageCounts.DELIVERED_TO_CITY}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Cronologia completa</p>
                <h2>Data e horário de cada ação</h2>
              </div>
            </div>
            <div className="city-report-table-wrap">
              <table className="city-report-table movement-report-table">
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>Cidade</th>
                    <th>Passageiro</th>
                    <th>Lacre</th>
                    <th>Ação</th>
                    <th>Origem → destino</th>
                  </tr>
                </thead>
                <tbody>
                  {report.movementTimeline.map(({ movement, luggage, passenger }) => (
                    <tr key={movement.id}>
                      <td>{formatDateTime(movement.occurredAt)}</td>
                      <td>{passenger.city}</td>
                      <td>{passenger.fullName}</td>
                      <td>{luggage.code}</td>
                      <td>
                        {MOVEMENT_LABELS[movement.type]}
                        {movement.isException ? ' · Exceção' : ''}
                      </td>
                      <td>{movementRoute(movement)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="print-report" aria-label="Relatório operacional para impressão">
        <header className="print-report__header">
          <div>
            <p>Caravana Flávio Gonçalves</p>
            <h1>Relatório Operacional de Bagagens</h1>
          </div>
          <div className="print-report__meta">
            <strong>Emitido em</strong>
            <span>{formatDateTime(report.generatedAt)}</span>
            <span>{report.passengerCount} passageiros · {report.luggageCount} bagagens</span>
          </div>
        </header>

        <section className="print-report__section">
          <h2>Resumo geral</h2>
          <div className="print-summary-grid">
            <div><span>Passageiros sem bagagem</span><strong>{report.passengerWithoutLuggageCount}</strong></div>
            <div><span>Exceções registradas</span><strong>{report.exceptionCount}</strong></div>
            <div><span>Fechamentos divergentes</span><strong>{report.divergentClosureCount}</strong></div>
            <div><span>Volumes cadastrados</span><strong>{report.luggageCount}</strong></div>
          </div>
        </section>

        <section className="print-report__section">
          <h2>Localização atual das bagagens</h2>
          <table className="print-table">
            <thead>
              <tr>
                {STAGE_OPTIONS.map(([stage, label]) => <th key={stage}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                {STAGE_OPTIONS.map(([stage]) => <td key={stage}>{report.stageCounts[stage]}</td>)}
              </tr>
            </tbody>
          </table>
        </section>

        <section className="print-report__section">
          <h2>Totais por período</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Período</th>
                <th>Passageiros</th>
                <th>Bagagens</th>
                <th>No galpão</th>
                <th>Carreta ida</th>
                <th>Com passageiro</th>
                <th>Carreta retorno</th>
                <th>Galpão retorno</th>
                <th>Entregues à cidade</th>
              </tr>
            </thead>
            <tbody>
              {report.periodSummaries.map((summary) => (
                <tr key={summary.travelPeriod}>
                  <td>{TRAVEL_PERIOD_LABELS[summary.travelPeriod]}</td>
                  <td>{summary.passengerCount}</td>
                  <td>{summary.luggageCount}</td>
                  <td>{summary.stageCounts.WAREHOUSE_INITIAL}</td>
                  <td>{summary.stageCounts.TRAILER_OUTBOUND}</td>
                  <td>{summary.stageCounts.WITH_PASSENGER}</td>
                  <td>{summary.stageCounts.TRAILER_RETURN}</td>
                  <td>{summary.stageCounts.WAREHOUSE_RETURN}</td>
                  <td>{summary.stageCounts.DELIVERED_TO_CITY}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-report__section print-page-break-before">
          <h2>Totais por município e etapa</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Cidade</th>
                <th>Passageiros</th>
                <th>Bagagens</th>
                <th>No galpão</th>
                <th>Carreta ida</th>
                <th>Com passageiro</th>
                <th>Carreta retorno</th>
                <th>Galpão retorno</th>
                <th>Entregues à cidade</th>
              </tr>
            </thead>
            <tbody>
              {report.citySummaries.map((summary) => (
                <tr key={summary.city}>
                  <td>{summary.city}</td>
                  <td>{summary.passengerCount}</td>
                  <td>{summary.luggageCount}</td>
                  <td>{summary.stageCounts.WAREHOUSE_INITIAL}</td>
                  <td>{summary.stageCounts.TRAILER_OUTBOUND}</td>
                  <td>{summary.stageCounts.WITH_PASSENGER}</td>
                  <td>{summary.stageCounts.TRAILER_RETURN}</td>
                  <td>{summary.stageCounts.WAREHOUSE_RETURN}</td>
                  <td>{summary.stageCounts.DELIVERED_TO_CITY}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-report__section print-page-break-before">
          <h2>Cronologia das movimentações</h2>
          <table className="print-table print-table--timeline">
            <thead>
              <tr>
                <th>Data e hora</th>
                <th>Cidade</th>
                <th>Passageiro</th>
                <th>Lacre</th>
                <th>Ação</th>
                <th>Origem → destino</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {report.movementTimeline.map(({ movement, luggage, passenger }) => (
                <tr key={movement.id}>
                  <td>{formatDateTime(movement.occurredAt)}</td>
                  <td>{passenger.city}</td>
                  <td>{passenger.fullName}</td>
                  <td>{luggage.code}</td>
                  <td>{MOVEMENT_LABELS[movement.type]}</td>
                  <td>{movementRoute(movement)}</td>
                  <td>
                    {movement.isException
                      ? `Exceção: ${movement.exceptionReason || 'sem justificativa'}`
                      : movement.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-report__section print-page-break-before">
          <h2>Fechamentos das etapas</h2>
          {report.closures.length === 0 ? (
            <p className="print-empty-message">Nenhuma etapa foi finalizada.</p>
          ) : (
            <table className="print-table">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Etapa</th>
                  <th>Conferidas</th>
                  <th>Restantes</th>
                  <th>Fora do fluxo</th>
                  <th>Sem bagagem</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {report.closures.map((closure) => (
                  <tr key={closure.id}>
                    <td>{formatDateTime(closure.finalizedAt)}</td>
                    <td>{operationTitle(closure.operationKey)}</td>
                    <td>{closure.completedCount}</td>
                    <td>{closure.remainingLuggageIds.length}</td>
                    <td>{closure.unexpectedLuggageIds.length}</td>
                    <td>{closure.passengerIdsWithoutLuggage.length}</td>
                    <td>{closure.note || 'Sem observações.'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </section>

      <Modal
        open={Boolean(historyTarget)}
        title={historyTarget ? `Histórico da bagagem ${historyTarget.code}` : 'Histórico da bagagem'}
        subtitle={historyTarget ? `${historyTarget.passenger.fullName} · ${historyTarget.passenger.city}` : undefined}
        onClose={closeHistory}
        size="large"
      >
        {historyLoading ? (
          <div className="loading-state"><LoaderCircle className="spin" /> Carregando histórico...</div>
        ) : (
          <div className="history-timeline">
            {historyMovements.map((movement) => {
              const photos = historyPhotos.filter((photo) =>
                (movement.photoIds ?? []).includes(photo.id),
              )
              return (
                <article className="history-entry" key={movement.id}>
                  <div className="history-entry__marker"><Clock3 aria-hidden="true" /></div>
                  <div className="history-entry__body">
                    <div className="history-entry__heading">
                      <strong>{MOVEMENT_LABELS[movement.type]}</strong>
                      <time>{formatDateTime(movement.occurredAt)}</time>
                    </div>
                    <p>{movement.note}</p>
                    {movement.isException ? (
                      <div className="history-exception-note">
                        <ShieldAlert aria-hidden="true" />
                        <span>Exceção: {movement.exceptionReason || 'Sem justificativa registrada.'}</span>
                      </div>
                    ) : null}
                    {photos.length > 0 ? (
                      <div className="history-photo-grid">
                        {photos.map((photo) => (
                          <button
                            type="button"
                            key={photo.id}
                            onClick={() => setPhotoViewer({
                              title: 'Fotografia vinculada à movimentação',
                              url: historyPhotoUrls[photo.id],
                            })}
                          >
                            <img src={historyPhotoUrls[photo.id]} alt="Comprovante da movimentação" />
                            <span>Foto</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <small className="history-no-photo">Nenhuma fotografia vinculada a esta etapa.</small>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(photoViewer)} title={photoViewer?.title ?? 'Fotografia'} onClose={() => setPhotoViewer(null)} size="large">
        {photoViewer ? <div className="photo-viewer"><img src={photoViewer.url} alt={photoViewer.title} /></div> : null}
      </Modal>
    </div>
  )
}

function ReportSummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: number
  icon: ReactNode
  tone: 'blue' | 'amber' | 'red'
}) {
  return (
    <article className={`report-summary-card tone-${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function ReportTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={active ? 'is-active' : undefined} onClick={onClick}>
      {children}
    </button>
  )
}

function PendencyCard({ item }: { item: CentralPendency }) {
  if (item.kind === 'PASSENGER_WITHOUT_LUGGAGE' && item.passenger) {
    return (
      <article className="pendency-card tone-amber">
        <div className="pendency-card__icon"><UserRound aria-hidden="true" /></div>
        <div className="pendency-card__content">
          <span className="pendency-card__kind">Passageiro sem bagagem</span>
          <h3>{item.passenger.fullName}</h3>
          <p>Nenhum volume foi cadastrado para este passageiro.</p>
          <div className="badge-row">
            <span className="info-badge"><MapPin />{item.passenger.city}</span>
            <span className={`period-badge period-${item.passenger.travelPeriod.toLowerCase()}`}>
              {TRAVEL_PERIOD_LABELS[item.passenger.travelPeriod]}
            </span>
          </div>
        </div>
      </article>
    )
  }

  if (item.kind === 'MOVEMENT_EXCEPTION' && item.movement) {
    return (
      <article className="pendency-card tone-red">
        <div className="pendency-card__icon"><ShieldAlert aria-hidden="true" /></div>
        <div className="pendency-card__content">
          <span className="pendency-card__kind">Exceção registrada</span>
          <h3>Bagagem {item.luggage?.code ?? 'sem código'}</h3>
          <p>{item.passenger?.fullName ?? 'Passageiro não localizado'} · {operationTitle(item.movement.operationKey)}</p>
          <blockquote>{item.movement.exceptionReason || 'Sem justificativa registrada.'}</blockquote>
          <time>{formatDateTime(item.movement.occurredAt)}</time>
        </div>
      </article>
    )
  }

  if (item.kind === 'CLOSURE_DIVERGENCE' && item.closure) {
    const closure = item.closure
    return (
      <article className="pendency-card tone-amber">
        <div className="pendency-card__icon"><CircleAlert aria-hidden="true" /></div>
        <div className="pendency-card__content">
          <span className="pendency-card__kind">Fechamento com divergência</span>
          <h3>{operationTitle(closure.operationKey)}</h3>
          <p>
            {closure.remainingLuggageIds.length} restantes · {closure.unexpectedLuggageIds.length} fora do fluxo · {closure.passengerIdsWithoutLuggage.length} passageiros sem bagagem
          </p>
          {closure.note ? <blockquote>{closure.note}</blockquote> : null}
          <time>{formatDateTime(closure.finalizedAt)}</time>
        </div>
      </article>
    )
  }


  if (item.kind === 'CITY_TRANSFER_DIVERGENCE' && item.cityTransfer) {
    const transfer = item.cityTransfer
    return (
      <article className="pendency-card tone-amber">
        <div className="pendency-card__icon"><Truck aria-hidden="true" /></div>
        <div className="pendency-card__content">
          <span className="pendency-card__kind">Entrega municipal com divergência</span>
          <h3>{transfer.city}</h3>
          <p>{transfer.scannedLuggageIds.length} volumes entregues · {transfer.missingLuggageIds.length} não transferidos</p>
          {transfer.issueNote ? <blockquote>{transfer.issueNote}</blockquote> : null}
          <time>{formatDateTime(transfer.finalizedAt ?? transfer.updatedAt)}</time>
        </div>
      </article>
    )
  }

  return null
}
