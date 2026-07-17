import {
  AlertTriangle,
  Barcode,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileCheck2,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Printer,
  RefreshCcw,
  Search,
  ShieldAlert,
  Truck,
  UserRoundCheck,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { Modal } from '../components/Modal'
import { CITIES } from '../constants/cities'
import { STAGE_LABELS } from '../constants/operations'
import {
  addLuggageToCityTransferDraft,
  checkLuggageForCityTransfer,
  finalizeCityTransfer,
  getCityDeliveryOverview,
  getCityTransferReceipt,
  getCityTransferWorkspace,
  removeLuggageFromCityTransferDraft,
  saveCityTransferDraftDetails,
} from '../data/repository'
import type {
  CityDeliveryOverview,
  CityDeliverySummary,
  CityTransferDetailsInput,
  CityTransferReceipt,
  CityTransferWorkspace,
} from '../domain/types'

type CityLuggageView = 'PENDING' | 'SCANNED' | 'NOT_READY' | 'ALL'

const emptyDetails: CityTransferDetailsInput = {
  responsibleName: '',
  vehicleDescription: '',
  vehiclePlate: '',
  note: '',
}

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

function printFileName(receipt: CityTransferReceipt) {
  const date = new Date(receipt.transfer.finalizedAt ?? receipt.transfer.updatedAt)
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  const timePart = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('')
  const city = receipt.transfer.city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `Comprovante_Entrega_Bagagens_${city}_${datePart}_${timePart}`
}

function friendlyError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function CityDeliveryPage() {
  const [overview, setOverview] = useState<CityDeliveryOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [query, setQuery] = useState('')
  const [onlyWithLuggage, setOnlyWithLuggage] = useState(true)

  const [workspace, setWorkspace] = useState<CityTransferWorkspace | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [details, setDetails] = useState<CityTransferDetailsInput>(emptyDetails)
  const [detailsSaveError, setDetailsSaveError] = useState('')
  const [code, setCode] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [processingCode, setProcessingCode] = useState(false)
  const [luggageView, setLuggageView] = useState<CityLuggageView>('PENDING')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'danger'
    title: string
    message: string
  } | null>(null)

  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [issueNote, setIssueNote] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [receipt, setReceipt] = useState<CityTransferReceipt | null>(null)
  const [receiptLoading, setReceiptLoading] = useState(false)

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true)
      setPageError('')
      setOverview(await getCityDeliveryOverview())
    } catch (error) {
      setPageError(friendlyError(error, 'Não foi possível carregar as entregas por cidade.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const loadWorkspace = useCallback(async (city: string, preserveDetails = false) => {
    try {
      setWorkspaceLoading(true)
      setFeedback(null)
      setDetailsSaveError('')
      const result = await getCityTransferWorkspace(city)
      setWorkspace(result)
      if (!preserveDetails) {
        setDetails({
          responsibleName: result.transfer.responsibleName,
          vehicleDescription: result.transfer.vehicleDescription,
          vehiclePlate: result.transfer.vehiclePlate,
          note: result.transfer.note,
        })
      }
    } catch (error) {
      setPageError(friendlyError(error, 'Não foi possível abrir a transferência da cidade.'))
    } finally {
      setWorkspaceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!workspace || workspace.transfer.status !== 'DRAFT') return
    const timeout = window.setTimeout(() => {
      void saveCityTransferDraftDetails(workspace.transfer.id, details)
        .then((transfer) => {
          setWorkspace((current) => current ? { ...current, transfer } : current)
          setDetailsSaveError('')
        })
        .catch((error) => {
          setDetailsSaveError(
            friendlyError(error, 'Não foi possível salvar os dados do veículo.'),
          )
        })
    }, 450)
    return () => window.clearTimeout(timeout)
  }, [details, workspace?.transfer.id, workspace?.transfer.status])

  const visibleCities = useMemo(() => {
    if (!overview) return []
    const normalized = normalizeSearch(query)
    return overview.cities.filter((summary) => {
      const matchesQuery = !normalized || normalizeSearch(summary.city).includes(normalized)
      const matchesLuggage = !onlyWithLuggage || summary.luggageCount > 0
      return matchesQuery && matchesLuggage
    })
  }, [onlyWithLuggage, overview, query])

  const visibleWorkspaceLuggage = useMemo(() => {
    if (!workspace) return []
    const scanned = new Set(workspace.transfer.scannedLuggageIds)
    return workspace.luggage.filter((item) => {
      if (luggageView === 'ALL') return true
      if (luggageView === 'SCANNED') return scanned.has(item.id)
      if (luggageView === 'NOT_READY') {
        return item.currentStage !== 'WAREHOUSE_RETURN' && item.currentStage !== 'DELIVERED_TO_CITY'
      }
      return item.currentStage === 'WAREHOUSE_RETURN' && !scanned.has(item.id)
    })
  }, [luggageView, workspace])

  const openCity = async (summary: CityDeliverySummary) => {
    setWorkspace(null)
    setLuggageView('PENDING')
    setCode('')
    setIssueNote('')
    await loadWorkspace(summary.city)
  }

  const closeWorkspace = () => {
    setWorkspace(null)
    setCode('')
    setFeedback(null)
    setDetailsSaveError('')
    setIssueNote('')
  }

  const processCode = async (rawCode: string) => {
    if (!workspace) return
    if (!rawCode.trim()) {
      setFeedback({
        tone: 'warning',
        title: 'Código não informado',
        message: 'Digite ou escaneie o código do lacre.',
      })
      return
    }

    try {
      setProcessingCode(true)
      setFeedback(null)
      const check = await checkLuggageForCityTransfer(
        workspace.city,
        workspace.transfer.id,
        rawCode,
      )
      if (check.status !== 'READY' || !check.luggage || !check.passenger) {
        setFeedback({
          tone:
            check.status === 'ALREADY_SCANNED' || check.status === 'ALREADY_DELIVERED'
              ? 'warning'
              : 'danger',
          title:
            check.status === 'WRONG_CITY'
              ? 'Bagagem de outra cidade'
              : check.status === 'NOT_READY'
                ? 'Bagagem ainda não está no galpão de retorno'
                : check.status === 'ALREADY_SCANNED'
                  ? 'Leitura repetida'
                  : check.status === 'ALREADY_DELIVERED'
                    ? 'Bagagem já entregue'
                    : check.status === 'NOT_FOUND'
                      ? 'Bagagem não encontrada'
                      : 'Leitura bloqueada',
          message: check.message,
        })
        return
      }

      await addLuggageToCityTransferDraft(workspace.transfer.id, check.luggage.id)
      setFeedback({
        tone: 'success',
        title: `${check.luggage.code} conferida`,
        message: `${check.passenger.fullName} · volume separado para ${workspace.city}.`,
      })
      setCode('')
      await loadWorkspace(workspace.city, true)
      setLuggageView('PENDING')
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível registrar',
        message: friendlyError(error, 'Tente novamente.'),
      })
    } finally {
      setProcessingCode(false)
    }
  }

  const handleSubmitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void processCode(code)
  }

  const handleDetected = (detectedCode: string) => {
    setScannerOpen(false)
    setCode(detectedCode)
    void processCode(detectedCode)
  }

  const removeScanned = async (luggageId: string) => {
    if (!workspace) return
    try {
      await removeLuggageFromCityTransferDraft(workspace.transfer.id, luggageId)
      await loadWorkspace(workspace.city, true)
      setFeedback({
        tone: 'warning',
        title: 'Bagagem retirada da conferência',
        message: 'O volume voltou para a lista de pendentes desta cidade.',
      })
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível retirar a bagagem',
        message: friendlyError(error, 'Tente novamente.'),
      })
    }
  }

  const remainingAtFinalize = workspace
    ? workspace.luggage.filter(
        (item) =>
          item.currentStage !== 'DELIVERED_TO_CITY' &&
          !workspace.transfer.scannedLuggageIds.includes(item.id),
      ).length
    : 0

  const handleFinalize = async () => {
    if (!workspace) return
    try {
      setFinalizing(true)
      setFeedback(null)
      const result = await finalizeCityTransfer(
        workspace.transfer.id,
        details,
        issueNote,
      )
      setFinalizeOpen(false)
      setReceipt(result)
      closeWorkspace()
      await loadOverview()
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível finalizar a transferência',
        message: friendlyError(error, 'Confira os dados obrigatórios.'),
      })
      setFinalizeOpen(false)
    } finally {
      setFinalizing(false)
    }
  }

  const openReceipt = async (transferId: string) => {
    try {
      setReceipt(null)
      setReceiptLoading(true)
      setReceipt(await getCityTransferReceipt(transferId))
    } catch (error) {
      setPageError(friendlyError(error, 'Não foi possível abrir o comprovante.'))
    } finally {
      setReceiptLoading(false)
    }
  }

  const printReceipt = () => {
    if (!receipt) return
    const previousTitle = document.title
    document.title = printFileName(receipt)
    window.print()
    window.setTimeout(() => {
      document.title = previousTitle
    }, 500)
  }

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" aria-hidden="true" />
        Carregando cidades e bagagens...
      </div>
    )
  }

  if (!overview) {
    return <div className="alert alert--danger">{pageError || 'Operação indisponível.'}</div>
  }

  const totalReady = overview.cities.reduce((sum, city) => sum + city.readyCount, 0)
  const totalDelivered = overview.cities.reduce((sum, city) => sum + city.deliveredCount, 0)
  const totalNotReady = overview.cities.reduce((sum, city) => sum + city.notReadyCount, 0)

  return (
    <div className="city-delivery-page">
      <section className="operation-page-hero city-delivery-hero">
        <div>
          <p className="eyebrow">Transferência final por município</p>
          <h2>Entregar bagagens às cidades</h2>
          <p>Confira os lacres, identifique o responsável e registre o veículo que levará cada carga.</p>
        </div>
        <div className="operation-page-hero__stage">
          <span>No galpão de retorno</span>
          <strong>→</strong>
          <span>Caminhão da cidade</span>
        </div>
      </section>

      <section className="operation-summary-grid city-delivery-summary-grid">
        <CitySummaryCard label="Cidades" value={CITIES.length} icon={<Building2 />} />
        <CitySummaryCard label="Prontas no galpão" value={totalReady} icon={<PackageCheck />} tone="green" />
        <CitySummaryCard label="Já entregues" value={totalDelivered} icon={<Truck />} tone="blue" />
        <CitySummaryCard label="Ainda não retornaram" value={totalNotReady} icon={<AlertTriangle />} tone="amber" />
      </section>

      <section className="operation-passenger-guidance">
        <ShieldAlert aria-hidden="true" />
        <div>
          <strong>Uma cidade por vez</strong>
          <p>Uma bagagem de outro município será bloqueada antes de entrar na transferência.</p>
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cargas municipais</p>
            <h2>Selecione a cidade</h2>
          </div>
          <button type="button" className="secondary-button" onClick={() => void loadOverview()}>
            <RefreshCcw aria-hidden="true" />
            Atualizar
          </button>
        </div>

        <div className="city-delivery-filter-card">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar cidade" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Limpar"><X /></button> : null}
          </label>
          <label className="city-toggle-field">
            <input type="checkbox" checked={onlyWithLuggage} onChange={(event) => setOnlyWithLuggage(event.target.checked)} />
            Mostrar apenas cidades com bagagens
          </label>
        </div>

        {pageError ? <div className="alert alert--danger">{pageError}</div> : null}

        <div className="city-delivery-grid">
          {visibleCities.map((summary) => (
            <CityDeliveryCard
              key={summary.city}
              summary={summary}
              onOpen={() => void openCity(summary)}
            />
          ))}
        </div>
      </section>

      <section className="city-transfer-history-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Comprovantes</p>
            <h2>Transferências finalizadas</h2>
          </div>
          <span className="operation-list-count">{overview.finalizedTransfers.length}</span>
        </div>
        {overview.finalizedTransfers.length === 0 ? (
          <div className="mini-empty-state">
            <FileCheck2 aria-hidden="true" />
            <p>Nenhuma transferência para cidade foi finalizada.</p>
          </div>
        ) : (
          <div className="city-transfer-history-list">
            {overview.finalizedTransfers.map((transfer) => (
              <article className={transfer.missingLuggageIds.length > 0 ? 'city-transfer-history-item has-issues' : 'city-transfer-history-item'} key={transfer.id}>
                <div>
                  <strong>{transfer.city}</strong>
                  <span>{formatDateTime(transfer.finalizedAt ?? transfer.updatedAt)}</span>
                </div>
                <div className="city-transfer-history-meta">
                  <span>{transfer.scannedLuggageIds.length} volumes</span>
                  {transfer.missingLuggageIds.length > 0 ? <em>{transfer.missingLuggageIds.length} não transferidos</em> : <em className="is-clear">Sem divergências</em>}
                </div>
                <button type="button" className="mini-action-button" onClick={() => void openReceipt(transfer.id)}>
                  <Printer aria-hidden="true" />
                  <span>Comprovante</span>
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={Boolean(workspace) || workspaceLoading}
        title={workspace ? `Transferir bagagens de ${workspace.city}` : 'Carregando cidade'}
        subtitle={workspace ? 'Confira cada lacre antes de entregar a carga ao responsável.' : undefined}
        onClose={closeWorkspace}
        size="large"
      >
        {workspaceLoading && !workspace ? (
          <div className="loading-state"><LoaderCircle className="spin" /> Carregando...</div>
        ) : workspace ? (
          <div className="city-transfer-workspace">
            <section className="city-transfer-progress-grid">
              <div><span>Volumes da cidade</span><strong>{workspace.totalCount}</strong></div>
              <div className="is-ready"><span>No galpão</span><strong>{workspace.readyCount}</strong></div>
              <div className="is-scanned"><span>Conferidos</span><strong>{workspace.scannedCount}</strong></div>
              <div className={workspace.notReadyCount > 0 ? 'has-issues' : 'is-clear'}><span>Não prontos</span><strong>{workspace.notReadyCount}</strong></div>
            </section>

            <section className="city-transfer-details-card">
              <div className="form-section-title">
                <Truck aria-hidden="true" />
                <div>
                  <strong>Responsável e veículo</strong>
                  <span>Os dados ficam salvos automaticamente nesta conferência.</span>
                </div>
              </div>
              <div className="form-grid city-transfer-details-grid">
                <label className="field">
                  <span>Responsável pelo recebimento *</span>
                  <input value={details.responsibleName} onChange={(event) => setDetails((current) => ({ ...current, responsibleName: event.target.value }))} placeholder="Nome completo" />
                </label>
                <label className="field">
                  <span>Veículo *</span>
                  <input value={details.vehicleDescription} onChange={(event) => setDetails((current) => ({ ...current, vehicleDescription: event.target.value }))} placeholder="Ex.: Caminhão baú branco" />
                </label>
                <label className="field">
                  <span>Placa *</span>
                  <input value={details.vehiclePlate} onChange={(event) => setDetails((current) => ({ ...current, vehiclePlate: event.target.value.toLocaleUpperCase('pt-BR') }))} placeholder="ABC1D23" />
                </label>
                <label className="field">
                  <span>Observação</span>
                  <input value={details.note} onChange={(event) => setDetails((current) => ({ ...current, note: event.target.value }))} placeholder="Informação útil sobre a transferência" />
                </label>
              </div>
              {detailsSaveError ? <div className="alert alert--danger">{detailsSaveError}</div> : null}
            </section>

            <section className="operation-scan-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Conferência da cidade</p>
                  <h2>Registrar uma bagagem</h2>
                </div>
              </div>
              <form className="operation-code-form" onSubmit={handleSubmitCode}>
                <label className="field operation-code-field">
                  <span>Código do lacre</span>
                  <div className="operation-code-input">
                    <Barcode aria-hidden="true" />
                    <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Digite ou escaneie" autoComplete="off" />
                    {code ? <button type="button" onClick={() => setCode('')} aria-label="Limpar"><X /></button> : null}
                  </div>
                </label>
                <button type="button" className="secondary-button operation-scan-button" onClick={() => setScannerOpen(true)}>
                  <Barcode aria-hidden="true" />
                  Escanear
                </button>
                <button type="submit" className="primary-button" disabled={processingCode}>
                  {processingCode ? <LoaderCircle className="spin" /> : <Check />}
                  Confirmar
                </button>
              </form>
              {feedback ? (
                <div className={`operation-feedback operation-feedback--${feedback.tone}`}>
                  {feedback.tone === 'success' ? <CheckCircle2 /> : feedback.tone === 'warning' ? <CircleAlert /> : <ShieldAlert />}
                  <div><strong>{feedback.title}</strong><p>{feedback.message}</p></div>
                </div>
              ) : null}
            </section>

            <section className="city-transfer-luggage-card">
              <div className="city-transfer-list-header">
                <div className="form-section-title">
                  <BriefcaseBusiness aria-hidden="true" />
                  <div>
                    <strong>Volumes de {workspace.city}</strong>
                    <span>{visibleWorkspaceLuggage.length} exibidos</span>
                  </div>
                </div>
                <label className="select-field city-transfer-view-select">
                  <ChevronDown aria-hidden="true" />
                  <select value={luggageView} onChange={(event) => setLuggageView(event.target.value as CityLuggageView)}>
                    <option value="PENDING">Pendentes no galpão</option>
                    <option value="SCANNED">Conferidos</option>
                    <option value="NOT_READY">Ainda não retornaram</option>
                    <option value="ALL">Todos</option>
                  </select>
                  <ChevronDown aria-hidden="true" />
                </label>
              </div>

              {visibleWorkspaceLuggage.length === 0 ? (
                <div className="mini-empty-state">
                  <PackageCheck aria-hidden="true" />
                  <p>Nenhuma bagagem neste filtro.</p>
                </div>
              ) : (
                <div className="city-transfer-luggage-list">
                  {visibleWorkspaceLuggage.map((item) => {
                    const scanned = workspace.transfer.scannedLuggageIds.includes(item.id)
                    const delivered = item.currentStage === 'DELIVERED_TO_CITY'
                    const ready = item.currentStage === 'WAREHOUSE_RETURN'
                    return (
                      <article className={`city-transfer-luggage-row ${scanned ? 'is-scanned' : delivered ? 'is-delivered' : ready ? 'is-ready' : 'is-not-ready'}`} key={item.id}>
                        <span className="luggage-number"><BriefcaseBusiness /></span>
                        <div className="city-transfer-luggage-main">
                          <strong>{item.code}</strong>
                          <span>{item.passenger.fullName} · {item.luggageType} · {item.labelColor}</span>
                        </div>
                        <span className="city-transfer-luggage-status">
                          {scanned ? 'Conferida' : delivered ? 'Já entregue' : ready ? 'Pendente' : STAGE_LABELS[item.currentStage]}
                        </span>
                        {scanned ? (
                          <button type="button" className="mini-action-button mini-action-button--danger" onClick={() => void removeScanned(item.id)}>
                            <X aria-hidden="true" />
                            <span>Retirar</span>
                          </button>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <div className="city-transfer-footer">
              <div className={remainingAtFinalize > 0 ? 'passenger-complete-message' : 'passenger-complete-message is-complete'}>
                {remainingAtFinalize > 0 ? <Clock3 /> : <CheckCircle2 />}
                <span>{remainingAtFinalize > 0 ? `${remainingAtFinalize} volumes ainda não fazem parte desta transferência.` : 'Todos os volumes pendentes desta cidade foram conferidos.'}</span>
              </div>
              <button type="button" className="primary-button" disabled={workspace.scannedCount === 0} onClick={() => setFinalizeOpen(true)}>
                <UserRoundCheck aria-hidden="true" />
                Conferir e finalizar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <BarcodeScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleDetected} />

      <Modal
        open={finalizeOpen}
        title="Finalizar transferência para a cidade"
        subtitle={workspace?.city}
        onClose={() => setFinalizeOpen(false)}
        size="large"
      >
        {workspace ? (
          <div className="finalize-operation-layout">
            <div className={`finalize-status ${remainingAtFinalize > 0 ? 'has-issues' : 'is-clear'}`}>
              {remainingAtFinalize > 0 ? <AlertTriangle /> : <CheckCircle2 />}
              <div>
                <strong>{remainingAtFinalize > 0 ? 'Existem volumes não transferidos' : 'Carga conferida'}</strong>
                <p>{remainingAtFinalize > 0 ? 'A transferência pode ser finalizada somente com uma justificativa.' : 'Todos os volumes disponíveis da cidade foram conferidos.'}</p>
              </div>
            </div>
            <div className="finalize-issue-grid">
              <FinalizeNumber label="Volumes conferidos" value={workspace.scannedCount} positive />
              <FinalizeNumber label="Não transferidos" value={remainingAtFinalize} />
              <FinalizeNumber label="Responsável informado" value={details.responsibleName.trim() ? 1 : 0} positive={Boolean(details.responsibleName.trim())} />
              <FinalizeNumber label="Veículo e placa" value={details.vehicleDescription.trim() && details.vehiclePlate.trim() ? 1 : 0} positive={Boolean(details.vehicleDescription.trim() && details.vehiclePlate.trim())} />
            </div>
            {remainingAtFinalize > 0 ? (
              <label className="field">
                <span>Justificativa obrigatória</span>
                <textarea value={issueNote} onChange={(event) => setIssueNote(event.target.value)} rows={4} placeholder="Explique por que os volumes restantes não serão transferidos agora." />
              </label>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setFinalizeOpen(false)}>Voltar para conferir</button>
              <button
                type="button"
                className={remainingAtFinalize > 0 ? 'danger-button' : 'primary-button'}
                disabled={
                  finalizing ||
                  !details.responsibleName.trim() ||
                  !details.vehicleDescription.trim() ||
                  !details.vehiclePlate.trim() ||
                  (remainingAtFinalize > 0 && !issueNote.trim())
                }
                onClick={() => void handleFinalize()}
              >
                {finalizing ? <LoaderCircle className="spin" /> : <FileCheck2 />}
                {remainingAtFinalize > 0 ? 'Finalizar com divergência' : 'Finalizar transferência'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(receipt) || receiptLoading}
        title="Comprovante de transferência"
        subtitle={receipt?.transfer.city}
        onClose={() => setReceipt(null)}
        size="large"
      >
        {receiptLoading && !receipt ? (
          <div className="loading-state"><LoaderCircle className="spin" /> Carregando comprovante...</div>
        ) : receipt ? (
          <div className="city-receipt-modal-content">
            <CityReceiptContent receipt={receipt} />
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setReceipt(null)}>Fechar</button>
              <button type="button" className="primary-button" onClick={printReceipt}>
                <Printer aria-hidden="true" />
                Imprimir comprovante
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {receipt ? (
        <section className="city-receipt-print" aria-hidden="true">
          <CityReceiptContent receipt={receipt} />
        </section>
      ) : null}
    </div>
  )
}

function CitySummaryCard({ label, value, icon, tone = 'blue' }: { label: string; value: number; icon: ReactNode; tone?: 'blue' | 'green' | 'amber' }) {
  return (
    <article className={`operation-summary-card tone-${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function CityDeliveryCard({ summary, onOpen }: { summary: CityDeliverySummary; onOpen: () => void }) {
  const pending = Math.max(0, summary.luggageCount - summary.deliveredCount)
  return (
    <article className={`city-delivery-card ${pending === 0 && summary.luggageCount > 0 ? 'is-complete' : ''}`}>
      <div className="city-delivery-card__header">
        <div className="city-delivery-card__icon"><MapPin aria-hidden="true" /></div>
        <div>
          <h3>{summary.city}</h3>
          <span>{summary.passengerCount} passageiros · {summary.luggageCount} volumes</span>
        </div>
      </div>
      <div className="city-delivery-card__numbers">
        <span><strong>{summary.readyCount}</strong> no galpão</span>
        <span><strong>{summary.draftScannedCount}</strong> no rascunho</span>
        <span><strong>{summary.deliveredCount}</strong> entregues</span>
        <span className={summary.notReadyCount > 0 ? 'has-issues' : ''}><strong>{summary.notReadyCount}</strong> não prontos</span>
      </div>
      {summary.latestTransfer ? (
        <small>Última entrega: {formatDateTime(summary.latestTransfer.finalizedAt ?? summary.latestTransfer.updatedAt)}</small>
      ) : <small>Nenhuma entrega finalizada.</small>}
      <button type="button" className="primary-button" onClick={onOpen} disabled={summary.luggageCount === 0}>
        <Truck aria-hidden="true" />
        {pending === 0 && summary.luggageCount > 0 ? 'Revisar cidade' : 'Abrir transferência'}
      </button>
    </article>
  )
}

function FinalizeNumber({ label, value, positive = false }: { label: string; value: number; positive?: boolean }) {
  return (
    <article className={`finalize-issue ${positive ? 'is-positive' : value > 0 ? 'has-value' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function CityReceiptContent({ receipt }: { receipt: CityTransferReceipt }) {
  const transfer = receipt.transfer
  return (
    <article className="city-receipt-document">
      <header className="city-receipt-header">
        <div>
          <p>CARAVANA FLÁVIO GONÇALVES</p>
          <h2>Comprovante de transferência de bagagens</h2>
          <span>Entrega final da carga ao município</span>
        </div>
        <div className="city-receipt-city">
          <MapPin aria-hidden="true" />
          <strong>{transfer.city}</strong>
        </div>
      </header>

      <section className="city-receipt-details">
        <div><span>Data e horário</span><strong>{formatDateTime(transfer.finalizedAt ?? transfer.updatedAt)}</strong></div>
        <div><span>Responsável pelo recebimento</span><strong>{transfer.responsibleName}</strong></div>
        <div><span>Veículo</span><strong>{transfer.vehicleDescription}</strong></div>
        <div><span>Placa</span><strong>{transfer.vehiclePlate}</strong></div>
      </section>

      <section className="city-receipt-summary">
        <div><span>Volumes transferidos</span><strong>{receipt.items.length}</strong></div>
        <div className={receipt.missingItems.length > 0 ? 'has-issues' : 'is-clear'}><span>Volumes não transferidos</span><strong>{receipt.missingItems.length}</strong></div>
      </section>

      <section>
        <h3>Relação de volumes entregues</h3>
        <table className="city-receipt-table">
          <thead><tr><th>Lacre</th><th>Passageiro</th><th>Tipo</th><th>Cor</th></tr></thead>
          <tbody>
            {receipt.items.map(({ luggage, passenger }) => (
              <tr key={luggage.id}><td>{luggage.code}</td><td>{passenger.fullName}</td><td>{luggage.luggageType}</td><td>{luggage.labelColor}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {receipt.missingItems.length > 0 ? (
        <section className="city-receipt-divergence">
          <h3>Volumes não incluídos nesta transferência</h3>
          <p>{receipt.missingItems.map(({ luggage, passenger }) => `${luggage.code} · ${passenger.fullName}`).join('; ')}</p>
          <blockquote>{transfer.issueNote || 'Sem justificativa registrada.'}</blockquote>
        </section>
      ) : null}

      {transfer.note ? <section className="city-receipt-note"><strong>Observação</strong><p>{transfer.note}</p></section> : null}

      <footer className="city-receipt-signatures">
        <div><span>Responsável pela Caravana</span></div>
        <div><span>{transfer.responsibleName}</span><small>Responsável pelo recebimento</small></div>
      </footer>
    </article>
  )
}
