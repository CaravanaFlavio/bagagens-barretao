import {
  AlertTriangle,
  Barcode,
  BriefcaseBusiness,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Eye,
  ImageOff,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { Modal } from '../components/Modal'
import { PhotoCaptureButtons } from '../components/PhotoCaptureButtons'
import { CITIES } from '../constants/cities'
import { OPERATION_DEFINITIONS, STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import {
  checkLuggageForOperation,
  finalizeOperation,
  getLatestOperationEvidencePhoto,
  getOperationSnapshot,
  getPassengerOutboundVolumeCount,
  getPassengerSetPhoto,
  getSetReconciliation,
  moveLuggageForOperation,
  saveOperationEvidencePhoto,
  saveSetReconciliation,
} from '../data/repository'
import type {
  OperationKey,
  OperationPassengerGroup,
  OperationScanCheck,
  OperationSnapshot,
  OperationViewFilter,
  PhotoRecord,
  SetReconciliation,
  SetReconciliationOperationKey,
  SetReconciliationResult,
} from '../domain/types'
import { compressPhoto } from '../utils/imageCompression'

interface LuggageOperationPageProps {
  operationKey: OperationKey
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

function displayLuggageCode(code: string) {
  return code.startsWith('SEM-LACRE-') ? 'Sem lacre físico' : code
}

const SET_RECONCILIATION_LABELS: Record<SetReconciliationResult, string> = {
  NO_RELEVANT_CHANGE: 'Sem alteração relevante',
  REORGANIZED: 'Reorganizado / volumes agrupados',
  SPLIT_INCREASED: 'Volumes separados / aumentou a quantidade',
  POSSIBLE_MISSING: 'Possível volume faltante',
  ADDITIONAL_VOLUME: 'Volume adicional',
  OTHER: 'Outro',
}

function isSetReconciliationOperation(
  operationKey: OperationKey,
): operationKey is SetReconciliationOperationKey {
  return operationKey === 'COLLECT_FIRST_WEEK' || operationKey === 'COLLECT_SECOND_WEEK'
}

function getFriendlyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback

  const technicalMessage = error.message.toLocaleLowerCase('en-US')
  if (
    technicalMessage.includes('transaction has finished') ||
    technicalMessage.includes("failed to execute 'put' on 'idbobjectstore'")
  ) {
    return 'O banco local encerrou a gravação antes de concluir. Tente registrar novamente.'
  }

  return error.message || fallback
}

export function LuggageOperationPage({ operationKey }: LuggageOperationPageProps) {
  const definition = OPERATION_DEFINITIONS[operationKey]
  const isCollectionOperation = isSetReconciliationOperation(operationKey)
  const [snapshot, setSnapshot] = useState<OperationSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const [query, setQuery] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [viewFilter, setViewFilter] = useState<OperationViewFilter>('PENDING')
  const passengerListRef = useRef<HTMLElement>(null)

  const [selectedPassengerId, setSelectedPassengerId] = useState<string | null>(null)
  const [loadingPassengerPhoto, setLoadingPassengerPhoto] = useState(false)
  const [code, setCode] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [processingCode, setProcessingCode] = useState(false)
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'danger'
    title: string
    message: string
  } | null>(null)

  const [confirmationCheck, setConfirmationCheck] = useState<OperationScanCheck | null>(null)
  const [wrongPassengerCheck, setWrongPassengerCheck] = useState<OperationScanCheck | null>(null)
  const [exceptionReason, setExceptionReason] = useState('')

  const [originPhoto, setOriginPhoto] = useState<PhotoRecord | null>(null)
  const originPhotoUrl = useMemo(
    () => (originPhoto ? URL.createObjectURL(originPhoto.blob) : ''),
    [originPhoto],
  )
  const [passengerPhoto, setPassengerPhoto] = useState<PhotoRecord | null>(null)
  const passengerPhotoUrl = useMemo(
    () => (passengerPhoto ? URL.createObjectURL(passengerPhoto.blob) : ''),
    [passengerPhoto],
  )
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoViewer, setPhotoViewer] = useState<{ title: string; url: string } | null>(null)

  const [bulkFoundCount, setBulkFoundCount] = useState(0)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [setReconciliation, setSetReconciliation] = useState<SetReconciliation | null>(null)
  const [originalVolumeCount, setOriginalVolumeCount] = useState(0)
  const [reconciliationResult, setReconciliationResult] =
    useState<SetReconciliationResult>('NO_RELEVANT_CHANGE')
  const [reconciliationNote, setReconciliationNote] = useState('')

  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [finalizeNote, setFinalizeNote] = useState('')
  const [finalizing, setFinalizing] = useState(false)

  const loadSnapshot = useCallback(async () => {
    try {
      setPageError('')
      const result = await getOperationSnapshot(operationKey)
      setSnapshot(result)
    } catch (error) {
      setPageError(getFriendlyErrorMessage(error, 'Não foi possível carregar a operação.'))
    } finally {
      setLoading(false)
    }
  }, [operationKey])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setLoading(true)
      setSnapshot(null)
      setSelectedPassengerId(null)
      setCode('')
      setFeedback(null)
      setOriginPhoto(null)
      setPassengerPhoto(null)
      setBulkFoundCount(0)
      setSetReconciliation(null)
      setOriginalVolumeCount(0)
      setReconciliationResult('NO_RELEVANT_CHANGE')
      setReconciliationNote('')
      void loadSnapshot()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadSnapshot])

  useEffect(() => {
    if (!originPhotoUrl) return
    return () => URL.revokeObjectURL(originPhotoUrl)
  }, [originPhotoUrl])

  useEffect(() => {
    if (!passengerPhotoUrl) return
    return () => URL.revokeObjectURL(passengerPhotoUrl)
  }, [passengerPhotoUrl])

  const selectedGroup = useMemo(
    () => snapshot?.groups.find((group) => group.passenger.id === selectedPassengerId) ?? null,
    [selectedPassengerId, snapshot],
  )

  const visibleGroups = useMemo(() => {
    if (!snapshot) return []
    const normalizedQuery = normalizeSearch(query)

    return snapshot.groups.filter((group) => {
      const matchesCity = !cityFilter || group.passenger.city === cityFilter
      const matchesQuery =
        !normalizedQuery ||
        group.passenger.normalizedName.includes(normalizedQuery) ||
        group.luggage.some((item) => item.normalizedCode.includes(normalizedQuery))
      if (group.totalCount === 0) return false

      const matchesView =
        viewFilter === 'ALL' ||
        (viewFilter === 'PENDING' && group.pendingCount > 0) ||
        (viewFilter === 'COMPLETED' &&
          group.pendingCount === 0 &&
          group.unexpectedCount === 0) ||
        (viewFilter === 'UNEXPECTED' && group.unexpectedCount > 0)

      return matchesCity && matchesQuery && matchesView
    })
  }, [cityFilter, query, snapshot, viewFilter])

  const openPassenger = useCallback(async (group: OperationPassengerGroup) => {
    setSelectedPassengerId(group.passenger.id)
    setCode('')
    setFeedback(null)
    setConfirmationCheck(null)
    setWrongPassengerCheck(null)
    setExceptionReason('')
    setOriginPhoto(null)
    setPassengerPhoto(null)
    setSetReconciliation(null)
    setOriginalVolumeCount(0)
    setReconciliationResult('NO_RELEVANT_CHANGE')
    setReconciliationNote('')
    setBulkFoundCount(0)
    setLoadingPassengerPhoto(true)

    try {
      const collectionOperation = isSetReconciliationOperation(operationKey)
      const [origin, stagePhoto, reconciliation, outboundCount] = await Promise.all([
        getPassengerSetPhoto(group.passenger.id),
        getLatestOperationEvidencePhoto(operationKey, group.passenger.id),
        collectionOperation
          ? getSetReconciliation(operationKey, group.passenger.id)
          : Promise.resolve(undefined),
        collectionOperation
          ? getPassengerOutboundVolumeCount(group.passenger.id)
          : Promise.resolve(group.totalCount),
      ])

      setOriginPhoto(origin ?? null)
      setPassengerPhoto(stagePhoto ?? null)

      if (collectionOperation) {
        const baseline = reconciliation?.originalQuantity ?? outboundCount
        setSetReconciliation(reconciliation ?? null)
        setOriginalVolumeCount(baseline)
        setBulkFoundCount(reconciliation?.observedQuantity ?? baseline)
        setReconciliationResult(reconciliation?.result ?? 'NO_RELEVANT_CHANGE')
        setReconciliationNote(reconciliation?.note ?? '')
      } else {
        setBulkFoundCount(group.pendingCount)
      }
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível carregar as fotos deste passageiro',
        message: getFriendlyErrorMessage(error, 'Tente abrir o passageiro novamente.'),
      })
    } finally {
      setLoadingPassengerPhoto(false)
    }
  }, [operationKey])

  const closePassenger = () => {
    setSelectedPassengerId(null)
    setOriginPhoto(null)
    setPassengerPhoto(null)
    setBulkFoundCount(0)
    setSetReconciliation(null)
    setOriginalVolumeCount(0)
    setReconciliationResult('NO_RELEVANT_CHANGE')
    setReconciliationNote('')
    setCode('')
    setFeedback(null)
    setConfirmationCheck(null)
    setWrongPassengerCheck(null)
    setExceptionReason('')
  }

  const savePassengerEvidencePhoto = async (file: File) => {
    if (!selectedGroup) return

    try {
      setPhotoBusy(true)
      setFeedback(null)
      const compressed = await compressPhoto(file)
      const photo = await saveOperationEvidencePhoto(
        operationKey,
        selectedGroup.passenger.id,
        compressed,
      )
      setPassengerPhoto(photo)
      setFeedback({
        tone: 'success',
        title: 'Foto do passageiro pronta',
        message: `Esta imagem será vinculada somente às bagagens de ${selectedGroup.passenger.fullName} nesta etapa.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível salvar a foto',
        message: getFriendlyErrorMessage(error, 'Tente novamente.'),
      })
    } finally {
      setPhotoBusy(false)
    }
  }

  const confirmMovement = async (check: OperationScanCheck, reason?: string) => {
    if (!check.luggage || !check.passenger || !selectedGroup) return

    if (check.passenger.id !== selectedGroup.passenger.id) {
      setWrongPassengerCheck(check)
      return
    }

    if (!passengerPhoto) {
      setFeedback({
        tone: 'warning',
        title: 'Foto do conjunto necessária',
        message: `Tire a foto das bagagens de ${selectedGroup.passenger.fullName} antes de registrar os volumes.`,
      })
      return
    }

    await moveLuggageForOperation(operationKey, check.luggage.id, {
      photoId: passengerPhoto.id,
      exceptionReason: reason,
    })

    setFeedback({
      tone: 'success',
      title: `${check.luggage.code} confirmado`,
      message: `${check.passenger.fullName} · ${definition.successMessage}`,
    })
    setCode('')
    setConfirmationCheck(null)
    setExceptionReason('')
    await loadSnapshot()
  }

  const processCode = async (rawCode: string) => {
    if (!selectedGroup) {
      setFeedback({
        tone: 'warning',
        title: 'Selecione um passageiro',
        message: 'Abra o cartão do passageiro antes de registrar as bagagens.',
      })
      return
    }

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
      const check = await checkLuggageForOperation(operationKey, rawCode)

      if (check.passenger && check.passenger.id !== selectedGroup.passenger.id) {
        setWrongPassengerCheck(check)
        return
      }

      if (check.status === 'READY') {
        await confirmMovement(check)
        return
      }

      if (check.status === 'REQUIRES_CONFIRMATION') {
        if (!passengerPhoto) {
          setFeedback({
            tone: 'warning',
            title: 'Foto do conjunto necessária',
            message: `Tire a foto das bagagens de ${selectedGroup.passenger.fullName} antes de confirmar qualquer movimentação.`,
          })
          return
        }
        setConfirmationCheck(check)
        return
      }

      setFeedback({
        tone: check.status === 'ALREADY_COMPLETED' ? 'warning' : 'danger',
        title:
          check.status === 'ALREADY_COMPLETED'
            ? 'Leitura repetida'
            : check.status === 'BLOCKED'
              ? 'Movimentação bloqueada'
              : 'Bagagem não encontrada',
        message: check.message,
      })
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível registrar',
        message: getFriendlyErrorMessage(error, 'Tente novamente.'),
      })
    } finally {
      setProcessingCode(false)
    }
  }

  const handleConfirmSetReconciliation = async () => {
    if (!selectedGroup || !isSetReconciliationOperation(operationKey)) return

    const observedQuantity = Math.min(99, Math.max(0, Math.trunc(bulkFoundCount)))
    const baseline = originalVolumeCount || selectedGroup.totalCount

    if (!passengerPhoto) {
      setFeedback({
        tone: 'warning',
        title: 'Foto atual do conjunto necessária',
        message: `Tire uma foto das bagagens de ${selectedGroup.passenger.fullName} no recolhimento antes de concluir a conferência.`,
      })
      return
    }

    if (
      reconciliationResult === 'NO_RELEVANT_CHANGE' &&
      observedQuantity !== baseline
    ) {
      setFeedback({
        tone: 'warning',
        title: 'A quantidade mudou',
        message:
          'Se o número físico de volumes mudou, escolha “Reorganizado”, “Volumes separados”, “Volume adicional”, “Possível volume faltante” ou “Outro”. A diferença numérica não será tratada automaticamente como falta.',
      })
      return
    }

    if (
      (reconciliationResult === 'POSSIBLE_MISSING' ||
        reconciliationResult === 'OTHER') &&
      !reconciliationNote.trim()
    ) {
      setFeedback({
        tone: 'warning',
        title: 'Observação necessária',
        message: 'Descreva o que foi observado antes de salvar esta conferência.',
      })
      return
    }

    const pendingItems = selectedGroup.luggage.filter((item) => item.isPending)
    let movedCount = 0

    try {
      setBulkProcessing(true)
      setFeedback(null)

      for (const item of pendingItems) {
        await moveLuggageForOperation(operationKey, item.id, {
          photoId: passengerPhoto.id,
        })
        movedCount += 1
      }

      const saved = await saveSetReconciliation({
        passengerId: selectedGroup.passenger.id,
        operationKey,
        originalQuantity: baseline,
        observedQuantity,
        result: reconciliationResult,
        note: reconciliationNote,
        photoId: passengerPhoto.id,
      })

      setSetReconciliation(saved)
      setOriginalVolumeCount(saved.originalQuantity)
      setBulkFoundCount(saved.observedQuantity)

      const isAttention = saved.result === 'POSSIBLE_MISSING'
      setFeedback({
        tone: isAttention ? 'warning' : 'success',
        title: isAttention
          ? 'Conjunto recolhido com pendência registrada'
          : 'Conjunto conferido no retorno',
        message: isAttention
          ? `${selectedGroup.passenger.fullName}: ${saved.observedQuantity} volumes observados. A possível falta foi enviada para a Central de Pendências sem transformar a diferença numérica em volumes faltantes automáticos.`
          : `${selectedGroup.passenger.fullName}: saída com ${saved.originalQuantity} e retorno observado com ${saved.observedQuantity}. Situação registrada como “${SET_RECONCILIATION_LABELS[saved.result]}”.`,
      })
      await loadSnapshot()
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title:
          movedCount > 0
            ? 'Recolhimento parcialmente registrado'
            : 'Não foi possível salvar a conferência',
        message:
          movedCount > 0
            ? `${movedCount} ${movedCount === 1 ? 'registro interno avançou' : 'registros internos avançaram'} antes da falha. Reabra o passageiro e salve a conferência novamente; os volumes já movimentados não serão repetidos. ${getFriendlyErrorMessage(error, 'Tente novamente.')}`
            : getFriendlyErrorMessage(error, 'Tente novamente.'),
      })
      await loadSnapshot()
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleConfirmBulk = async () => {
    if (!selectedGroup) return
    if (isCollectionOperation) {
      await handleConfirmSetReconciliation()
      return
    }

    const requestedCount = Math.min(
      Math.max(0, Math.trunc(bulkFoundCount)),
      selectedGroup.pendingCount,
    )

    if (requestedCount <= 0) {
      setFeedback({
        tone: 'warning',
        title: 'Informe quantos volumes foram encontrados',
        message: 'Use os botões − e + ou digite a quantidade antes de confirmar o conjunto.',
      })
      return
    }

    if (!passengerPhoto) {
      setFeedback({
        tone: 'warning',
        title: 'Foto atual do conjunto necessária',
        message: `Tire uma foto das bagagens de ${selectedGroup.passenger.fullName} nesta etapa antes de confirmar o conjunto.`,
      })
      return
    }

    const pendingItems = selectedGroup.luggage
      .filter((item) => item.isPending)
      .slice(0, requestedCount)

    if (pendingItems.length === 0) {
      setFeedback({
        tone: 'warning',
        title: 'Nenhum volume pendente',
        message: 'Este passageiro não possui volumes pendentes para confirmar nesta etapa.',
      })
      return
    }

    let movedCount = 0

    try {
      setBulkProcessing(true)
      setFeedback(null)

      for (const item of pendingItems) {
        await moveLuggageForOperation(operationKey, item.id, {
          photoId: passengerPhoto.id,
        })
        movedCount += 1
      }

      const remainingCount = Math.max(0, selectedGroup.pendingCount - movedCount)
      setBulkFoundCount(remainingCount)
      setFeedback({
        tone: 'success',
        title: `${movedCount} ${movedCount === 1 ? 'volume confirmado' : 'volumes confirmados'}`,
        message:
          remainingCount === 0
            ? `${selectedGroup.passenger.fullName} ficou sem volumes pendentes nesta etapa.`
            : `Ainda ${remainingCount === 1 ? 'resta 1 volume' : `restam ${remainingCount} volumes`} para ${selectedGroup.passenger.fullName}.`,
      })
      await loadSnapshot()
    } catch (error) {
      const remainingCount = Math.max(0, selectedGroup.pendingCount - movedCount)
      setBulkFoundCount(remainingCount)
      setFeedback({
        tone: 'danger',
        title: movedCount > 0 ? 'Conjunto parcialmente registrado' : 'Não foi possível registrar o conjunto',
        message:
          movedCount > 0
            ? `${movedCount} de ${requestedCount} volumes foram gravados antes da falha. Não repita os que já foram confirmados. ${getFriendlyErrorMessage(error, 'Tente novamente com os volumes restantes.')}`
            : getFriendlyErrorMessage(error, 'Tente novamente.'),
      })
      await loadSnapshot()
    } finally {
      setBulkProcessing(false)
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

  const handleConfirmException = async () => {
    if (!confirmationCheck) return
    if (!exceptionReason.trim()) return
    try {
      setProcessingCode(true)
      await confirmMovement(confirmationCheck, exceptionReason)
    } catch (error) {
      setFeedback({
        tone: 'danger',
        title: 'Não foi possível confirmar a exceção',
        message: getFriendlyErrorMessage(error, 'Tente novamente.'),
      })
    } finally {
      setProcessingCode(false)
    }
  }

  const handleOpenCorrectPassenger = async () => {
    if (!wrongPassengerCheck?.passenger || !snapshot) return
    const correctGroup = snapshot.groups.find(
      (group) => group.passenger.id === wrongPassengerCheck.passenger?.id,
    )

    setWrongPassengerCheck(null)
    if (!correctGroup) {
      setFeedback({
        tone: 'danger',
        title: 'Passageiro fora desta operação',
        message: `${wrongPassengerCheck.passenger.fullName} não pertence à lista desta etapa. Confira o período antes de continuar.`,
      })
      return
    }

    await openPassenger(correctGroup)
  }

  const applySummaryFilter = (filter: OperationViewFilter) => {
    setQuery('')
    setCityFilter('')
    setViewFilter(filter)
    window.requestAnimationFrame(() => {
      passengerListRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const handleFinalize = async () => {
    if (!snapshot) return
    const hasIssues =
      snapshot.pendingLuggage > 0 ||
      snapshot.unexpectedLuggage > 0

    if (hasIssues && !finalizeNote.trim()) return

    try {
      setFinalizing(true)
      await finalizeOperation(operationKey, finalizeNote)
      setFinalizeOpen(false)
      setFinalizeNote('')
      setFeedback({
        tone: 'success',
        title: 'Conferência finalizada',
        message: hasIssues
          ? 'A etapa foi encerrada com divergências justificadas e registradas.'
          : 'Todos os volumes esperados foram conferidos.',
      })
      await loadSnapshot()
    } catch (error) {
      setPageError(getFriendlyErrorMessage(error, 'Não foi possível finalizar a etapa.'))
    } finally {
      setFinalizing(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" aria-hidden="true" />
        Carregando operação...
      </div>
    )
  }

  if (!snapshot) {
    return <div className="alert alert--danger">{pageError || 'Operação indisponível.'}</div>
  }

  const hasFinalizeIssues =
    snapshot.pendingLuggage > 0 ||
    snapshot.unexpectedLuggage > 0

  return (
    <div className="luggage-operation-page">
      <section className="operation-page-hero">
        <div>
          <p className="eyebrow">Conferência por passageiro</p>
          <h2>{definition.title}</h2>
          <p>{definition.subtitle}</p>
        </div>
        <div className="operation-page-hero__stage">
          <span>{STAGE_LABELS[definition.fromStage]}</span>
          <strong>→</strong>
          <span>{STAGE_LABELS[definition.toStage]}</span>
        </div>
      </section>

      {snapshot.latestClosure ? (
        <section className="operation-closure-banner">
          <Clock3 aria-hidden="true" />
          <div>
            <strong>Última conferência: {formatDateTime(snapshot.latestClosure.finalizedAt)}</strong>
            <p>{snapshot.latestClosure.note || 'Finalizada sem observações.'}</p>
          </div>
        </section>
      ) : null}

      <section className="operation-summary-grid" aria-label="Atalhos da conferência">
        <OperationSummaryCard
          label="Esperadas"
          value={snapshot.totalLuggage}
          icon={<BriefcaseBusiness />}
          active={viewFilter === 'ALL'}
          onClick={() => applySummaryFilter('ALL')}
        />
        <OperationSummaryCard
          label="Conferidas"
          value={snapshot.completedLuggage}
          icon={<CheckCircle2 />}
          tone="green"
          active={viewFilter === 'COMPLETED'}
          onClick={() => applySummaryFilter('COMPLETED')}
        />
        <OperationSummaryCard
          label="Restantes"
          value={snapshot.pendingLuggage}
          icon={<Clock3 />}
          tone="amber"
          active={viewFilter === 'PENDING'}
          onClick={() => applySummaryFilter('PENDING')}
        />
        <OperationSummaryCard
          label="Fora do fluxo"
          value={snapshot.unexpectedLuggage}
          icon={<AlertTriangle />}
          tone="red"
          active={viewFilter === 'UNEXPECTED'}
          onClick={() => applySummaryFilter('UNEXPECTED')}
        />
      </section>

      <section className="operation-passenger-guidance">
        <UserRoundCheck aria-hidden="true" />
        <div>
          <strong>Faça a conferência de um passageiro por vez</strong>
          <p>Abra o passageiro, fotografe o conjunto dele e leia somente os volumes daquele cadastro.</p>
        </div>
      </section>

      <section ref={passengerListRef}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Lista da etapa</p>
            <h2>Passageiros e volumes</h2>
          </div>
          <span className="operation-list-count">{visibleGroups.length} exibidos</span>
        </div>

        <div className="operation-filter-card">
          <label className="search-field">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou código do lacre" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Limpar"><X /></button> : null}
          </label>
          <label className="select-field">
            <MapPin aria-hidden="true" />
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="">Todas as cidades</option>
              {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <div className="operation-view-switch" role="group" aria-label="Filtrar situação">
            <button type="button" className={viewFilter === 'PENDING' ? 'is-active' : undefined} onClick={() => setViewFilter('PENDING')}>Pendentes</button>
            <button type="button" className={viewFilter === 'COMPLETED' ? 'is-active' : undefined} onClick={() => setViewFilter('COMPLETED')}>Conferidos</button>
            <button type="button" className={viewFilter === 'UNEXPECTED' ? 'is-active' : undefined} onClick={() => setViewFilter('UNEXPECTED')}>Fora do fluxo</button>
            <button type="button" className={viewFilter === 'ALL' ? 'is-active' : undefined} onClick={() => setViewFilter('ALL')}>Todos</button>
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <section className="empty-state operation-empty-state">
            <PackageCheck aria-hidden="true" />
            <h3>Nenhum passageiro neste filtro</h3>
            <p>Altere a cidade, a pesquisa ou a situação exibida.</p>
          </section>
        ) : (
          <div className="operation-passenger-list">
            {visibleGroups.map((group) => (
              <OperationPassengerCard
                key={group.passenger.id}
                group={group}
                onOpen={() => void openPassenger(group)}
              />
            ))}
          </div>
        )}
      </section>

      {pageError ? <div className="alert alert--danger">{pageError}</div> : null}

      <section className="operation-finalize-card">
        <div>
          <p className="eyebrow">Fechamento da etapa</p>
          <h2>Conferir antes de finalizar</h2>
          <p>O aplicativo mostrará somente bagagens restantes e situações fora do fluxo desta etapa.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setFinalizeOpen(true)}>
          <ShieldCheck aria-hidden="true" />
          Conferir e finalizar
        </button>
      </section>

      <Modal
        open={Boolean(selectedGroup)}
        title={selectedGroup ? `Conferir bagagens de ${selectedGroup.passenger.fullName}` : 'Conferir passageiro'}
        subtitle={selectedGroup ? `${selectedGroup.passenger.city} • ${TRAVEL_PERIOD_LABELS[selectedGroup.passenger.travelPeriod]} • ${definition.title}` : undefined}
        onClose={closePassenger}
        size="large"
      >
        {selectedGroup ? (
          <div className="passenger-operation-workspace">
            <section className="passenger-operation-progress">
              <div>
                <span>Volumes deste passageiro</span>
                <strong>{selectedGroup.totalCount}</strong>
              </div>
              <div className="is-completed">
                <span>Conferidos</span>
                <strong>{selectedGroup.completedCount}</strong>
              </div>
              <div className={selectedGroup.pendingCount > 0 ? 'has-pending' : 'is-completed'}>
                <span>Restantes</span>
                <strong>{selectedGroup.pendingCount}</strong>
              </div>
              <div className={selectedGroup.unexpectedCount > 0 ? 'has-unexpected' : 'is-completed'}>
                <span>Fora do fluxo</span>
                <strong>{selectedGroup.unexpectedCount}</strong>
              </div>
            </section>

            <section className={`operation-photo-card ${originPhoto ? 'has-photo' : 'is-pending'}`}>
              <div className="operation-photo-card__content">
                <div className="form-section-title">
                  <Eye aria-hidden="true" />
                  <div>
                    <strong>Foto de saída de Carmópolis</strong>
                    <span>Referência visual original para reconhecer o conjunto no chão.</span>
                  </div>
                </div>
                <p className={originPhoto ? 'photo-status photo-status--ok' : 'photo-status photo-status--pending'}>
                  {loadingPassengerPhoto
                    ? 'Carregando fotografia original...'
                    : originPhoto
                      ? `Foto original salva em ${formatDateTime(originPhoto.createdAt)}.`
                      : 'Este passageiro não possui foto original do conjunto cadastrada.'}
                </p>
              </div>

              <button
                type="button"
                className="operation-photo-preview"
                onClick={() => originPhotoUrl && setPhotoViewer({
                  title: `Foto de saída de Carmópolis · ${selectedGroup.passenger.fullName}`,
                  url: originPhotoUrl,
                })}
                disabled={!originPhotoUrl}
              >
                {originPhotoUrl ? <img src={originPhotoUrl} alt={`Bagagens de saída de ${selectedGroup.passenger.fullName}`} /> : <ImageOff aria-hidden="true" />}
                {originPhotoUrl ? <span><Eye /> Ampliar</span> : null}
              </button>
            </section>

            <section className={`operation-photo-card ${passengerPhoto ? 'has-photo' : 'is-pending'}`}>
              <div className="operation-photo-card__content">
                <div className="form-section-title">
                  <Camera aria-hidden="true" />
                  <div>
                    <strong>Foto atual do conjunto</strong>
                    <span>Registre como as bagagens estão nesta etapa antes de confirmar os volumes.</span>
                  </div>
                </div>
                <p className={passengerPhoto ? 'photo-status photo-status--ok' : 'photo-status photo-status--pending'}>
                  {loadingPassengerPhoto
                    ? 'Carregando fotografia...'
                    : passengerPhoto
                      ? `Foto ativa desde ${formatDateTime(passengerPhoto.createdAt)}.`
                      : 'Tire uma foto antes de registrar os volumes deste passageiro.'}
                </p>
                <PhotoCaptureButtons
                  onSelect={savePassengerEvidencePhoto}
                  busy={photoBusy || loadingPassengerPhoto}
                  cameraLabel={passengerPhoto ? 'Trocar foto' : 'Tirar foto'}
                  galleryLabel="Escolher da galeria"
                />
              </div>

              <button
                type="button"
                className="operation-photo-preview"
                onClick={() => passengerPhotoUrl && setPhotoViewer({
                  title: `Foto desta etapa · ${selectedGroup.passenger.fullName}`,
                  url: passengerPhotoUrl,
                })}
                disabled={!passengerPhotoUrl}
              >
                {passengerPhotoUrl ? <img src={passengerPhotoUrl} alt={`Conjunto de bagagens de ${selectedGroup.passenger.fullName}`} /> : <ImageOff aria-hidden="true" />}
                {passengerPhoto ? <span><Eye /> Ampliar</span> : null}
              </button>
            </section>

            {isCollectionOperation ? (
              <section className="operation-scan-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Conferência do conjunto no retorno</p>
                    <h2>Reconciliação visual do passageiro</h2>
                  </div>
                </div>

                <div className="operation-passenger-guidance">
                  <PackageCheck aria-hidden="true" />
                  <div>
                    <strong>A quantidade é uma referência, não uma sentença</strong>
                    <p>
                      Compare a foto de saída com o conjunto atual. Se 4 volumes viraram 2 porque foram agrupados,
                      registre 2 e marque “Reorganizado”. O aplicativo não transforma essa diferença em duas faltas.
                    </p>
                  </div>
                </div>

                {setReconciliation ? (
                  <div className={`operation-feedback ${setReconciliation.result === 'POSSIBLE_MISSING' ? 'operation-feedback--warning' : 'operation-feedback--success'}`}>
                    {setReconciliation.result === 'POSSIBLE_MISSING' ? <CircleAlert /> : <CheckCircle2 />}
                    <div>
                      <strong>Conferência registrada em {formatDateTime(setReconciliation.checkedAt)}</strong>
                      <p>
                        Saída: {setReconciliation.originalQuantity} · Retorno observado: {setReconciliation.observedQuantity} ·
                        {' '}{SET_RECONCILIATION_LABELS[setReconciliation.result]}.
                      </p>
                    </div>
                  </div>
                ) : null}

                <section className="passenger-operation-progress">
                  <div>
                    <span>Saída de Carmópolis</span>
                    <strong>{originalVolumeCount}</strong>
                  </div>
                  <div>
                    <span>Observados agora</span>
                    <strong>{bulkFoundCount}</strong>
                  </div>
                  <div className={bulkFoundCount === originalVolumeCount ? 'is-completed' : 'has-pending'}>
                    <span>Diferença numérica</span>
                    <strong>{bulkFoundCount - originalVolumeCount > 0 ? '+' : ''}{bulkFoundCount - originalVolumeCount}</strong>
                  </div>
                  <div className={reconciliationResult === 'POSSIBLE_MISSING' ? 'has-unexpected' : 'is-completed'}>
                    <span>Situação</span>
                    <strong>{reconciliationResult === 'POSSIBLE_MISSING' ? 'Atenção' : 'Conferir'}</strong>
                  </div>
                </section>

                <div className="operation-code-form">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setBulkFoundCount((current) => Math.max(0, current - 1))}
                    disabled={bulkProcessing || bulkFoundCount <= 0}
                    aria-label="Diminuir quantidade observada"
                  >
                    −
                  </button>

                  <label className="field operation-code-field">
                    <span>Volumes físicos observados</span>
                    <div className="operation-code-input">
                      <BriefcaseBusiness aria-hidden="true" />
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={bulkFoundCount}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value)
                          setBulkFoundCount(
                            Number.isFinite(nextValue)
                              ? Math.min(99, Math.max(0, Math.trunc(nextValue)))
                              : 0,
                          )
                        }}
                        inputMode="numeric"
                      />
                    </div>
                  </label>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setBulkFoundCount((current) => Math.min(99, current + 1))}
                    disabled={bulkProcessing || bulkFoundCount >= 99}
                    aria-label="Aumentar quantidade observada"
                  >
                    +
                  </button>
                </div>

                <label className="field">
                  <span>Como ficou o conjunto no retorno?</span>
                  <select
                    value={reconciliationResult}
                    onChange={(event) =>
                      setReconciliationResult(event.target.value as SetReconciliationResult)
                    }
                  >
                    <option value="NO_RELEVANT_CHANGE">Sem alteração relevante</option>
                    <option value="REORGANIZED">Reorganizado / volumes agrupados</option>
                    <option value="SPLIT_INCREASED">Volumes separados / aumentou a quantidade</option>
                    <option value="POSSIBLE_MISSING">Possível volume faltante</option>
                    <option value="ADDITIONAL_VOLUME">Volume adicional</option>
                    <option value="OTHER">Outro</option>
                  </select>
                </label>

                <label className="field">
                  <span>
                    Observação
                    {(reconciliationResult === 'POSSIBLE_MISSING' || reconciliationResult === 'OTHER')
                      ? ' (obrigatória)'
                      : ' (opcional)'}
                  </span>
                  <textarea
                    value={reconciliationNote}
                    onChange={(event) => setReconciliationNote(event.target.value)}
                    placeholder={
                      reconciliationResult === 'REORGANIZED'
                        ? 'Ex.: Os 4 volumes da ida foram acomodados em 2 volumes para o retorno.'
                        : reconciliationResult === 'POSSIBLE_MISSING'
                          ? 'Descreva o que parece estar faltando e o que já foi conferido.'
                          : 'Registre algo relevante sobre a organização atual do conjunto.'
                    }
                    rows={3}
                  />
                </label>

                <p className="photo-status photo-status--pending">
                  A diferença entre saída e retorno fica registrada como informação. Somente “Possível volume faltante”
                  gera uma pendência automática. Nenhum volume é criado ou apagado apenas por causa da quantidade observada.
                </p>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleConfirmBulk()}
                  disabled={bulkProcessing || loadingPassengerPhoto}
                >
                  {bulkProcessing ? <LoaderCircle className="spin" /> : <PackageCheck />}
                  {selectedGroup.pendingCount > 0
                    ? 'Conferir conjunto e recolher'
                    : setReconciliation
                      ? 'Atualizar conferência'
                      : 'Salvar conferência'}
                </button>
              </section>
            ) : (
              <section className="operation-scan-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Modo rápido por conjunto</p>
                    <h2>Confirmar volumes encontrados</h2>
                  </div>
                </div>

                <div className="operation-passenger-guidance">
                  <PackageCheck aria-hidden="true" />
                  <div>
                    <strong>Use quando os volumes não têm identificação física individual confiável</strong>
                    <p>
                      Compare com a foto de saída, conte o conjunto no chão, tire a foto atual e confirme a quantidade encontrada.
                      O aplicativo movimentará internamente apenas volumes que ainda estão pendentes.
                    </p>
                  </div>
                </div>

                <div className="operation-code-form">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setBulkFoundCount((current) => Math.max(0, current - 1))}
                    disabled={bulkProcessing || bulkFoundCount <= 0}
                    aria-label="Diminuir quantidade encontrada"
                  >
                    −
                  </button>

                  <label className="field operation-code-field">
                    <span>Volumes encontrados</span>
                    <div className="operation-code-input">
                      <BriefcaseBusiness aria-hidden="true" />
                      <input
                        type="number"
                        min={0}
                        max={selectedGroup.pendingCount}
                        value={bulkFoundCount}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value)
                          setBulkFoundCount(
                            Number.isFinite(nextValue)
                              ? Math.min(Math.max(0, Math.trunc(nextValue)), selectedGroup.pendingCount)
                              : 0,
                          )
                        }}
                        inputMode="numeric"
                      />
                    </div>
                  </label>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setBulkFoundCount((current) => Math.min(selectedGroup.pendingCount, current + 1))}
                    disabled={bulkProcessing || bulkFoundCount >= selectedGroup.pendingCount}
                    aria-label="Aumentar quantidade encontrada"
                  >
                    +
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleConfirmBulk()}
                    disabled={bulkProcessing || loadingPassengerPhoto || selectedGroup.pendingCount === 0}
                  >
                    {bulkProcessing ? <LoaderCircle className="spin" /> : <PackageCheck />}
                    Confirmar conjunto
                  </button>
                </div>

                <p className="photo-status photo-status--pending">
                  Esperados nesta etapa: {selectedGroup.pendingCount} {selectedGroup.pendingCount === 1 ? 'volume pendente' : 'volumes pendentes'}.
                  Se encontrar menos, confirme somente a quantidade localizada. Os demais continuarão como restantes.
                </p>
              </section>
            )}

            {feedback ? (
              <div className={`operation-feedback operation-feedback--${feedback.tone}`}>
                {feedback.tone === 'success' ? <CheckCircle2 /> : feedback.tone === 'warning' ? <CircleAlert /> : <ShieldAlert />}
                <div>
                  <strong>{feedback.title}</strong>
                  <p>{feedback.message}</p>
                </div>
              </div>
            ) : null}

            <section className="operation-scan-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Identificação individual</p>
                  <h2>Registrar por código ou lacre</h2>
                </div>
              </div>

              <form className="operation-code-form" onSubmit={handleSubmitCode}>
                <label className="field operation-code-field">
                  <span>Código do lacre</span>
                  <div className="operation-code-input">
                    <Barcode aria-hidden="true" />
                    <input
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Digite ou escaneie"
                      autoComplete="off"
                      inputMode="text"
                    />
                    {code ? (
                      <button type="button" onClick={() => setCode('')} aria-label="Limpar código"><X /></button>
                    ) : null}
                  </div>
                </label>

                <button type="button" className="secondary-button operation-scan-button" onClick={() => setScannerOpen(true)}>
                  <Camera aria-hidden="true" />
                  Escanear
                </button>
                <button type="submit" className="primary-button" disabled={processingCode || loadingPassengerPhoto}>
                  {processingCode ? <LoaderCircle className="spin" /> : <Check />}
                  Confirmar
                </button>
              </form>

            </section>

            <section className="passenger-operation-luggage-panel">
              <div className="form-section-title">
                <BriefcaseBusiness aria-hidden="true" />
                <div>
                  <strong>Volumes de {selectedGroup.passenger.fullName}</strong>
                  <span>Os registros abaixo continuam individuais por segurança do histórico, mesmo quando o conjunto é confirmado de uma vez.</span>
                </div>
              </div>

              {selectedGroup.totalCount === 0 ? (
                <div className="operation-zero-luggage"><AlertTriangle /> Nenhuma bagagem cadastrada para este passageiro.</div>
              ) : (
                <div className="operation-luggage-list">
                  {selectedGroup.luggage.map((item) => (
                    <div className="operation-luggage-row" key={item.id}>
                      <span className="luggage-number"><BriefcaseBusiness /></span>
                      <div>
                        <strong>{displayLuggageCode(item.code)}</strong>
                        <span>{item.luggageType} · {item.labelColor || 'Sem cor física'}</span>
                      </div>
                      <span className={`operation-stage-badge ${item.isCompleted ? 'is-completed' : item.isPending ? 'is-pending' : 'is-unexpected'}`}>
                        {STAGE_LABELS[item.currentStage]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="passenger-operation-footer">
              <div className={selectedGroup.totalCount > 0 && selectedGroup.pendingCount === 0 && selectedGroup.unexpectedCount === 0 ? 'passenger-complete-message is-complete' : 'passenger-complete-message'}>
                {selectedGroup.totalCount > 0 && selectedGroup.pendingCount === 0 && selectedGroup.unexpectedCount === 0 ? <CheckCircle2 /> : <Clock3 />}
                <span>
                  {selectedGroup.totalCount === 0
                    ? 'Este passageiro não possui bagagens cadastradas.'
                    : selectedGroup.unexpectedCount > 0
                      ? `${selectedGroup.unexpectedCount} ${selectedGroup.unexpectedCount === 1 ? 'bagagem está' : 'bagagens estão'} fora do fluxo desta etapa.`
                      : selectedGroup.pendingCount === 0
                        ? 'Todas as bagagens deste passageiro foram conferidas.'
                        : `Ainda faltam ${selectedGroup.pendingCount} ${selectedGroup.pendingCount === 1 ? 'bagagem' : 'bagagens'}.`}
                </span>
              </div>
              <button type="button" className="primary-button" onClick={closePassenger}>Fechar passageiro</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <BarcodeScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleDetected} />

      <Modal
        open={Boolean(wrongPassengerCheck)}
        title="Esta bagagem pertence a outro passageiro"
        subtitle="A leitura não foi registrada."
        onClose={() => setWrongPassengerCheck(null)}
      >
        {wrongPassengerCheck?.passenger && selectedGroup ? (
          <div className="exception-confirmation">
            <div className="alert alert--danger">
              <ShieldAlert aria-hidden="true" />
              <div>
                <strong>Bagagem {wrongPassengerCheck.luggage?.code}</strong>
                <p>
                  O código pertence a {wrongPassengerCheck.passenger.fullName}, mas você está conferindo {selectedGroup.passenger.fullName}.
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setWrongPassengerCheck(null)}>Cancelar leitura</button>
              <button type="button" className="primary-button" onClick={() => void handleOpenCorrectPassenger()}>
                Abrir passageiro correto
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmationCheck)}
        title="Confirmar movimentação fora do previsto?"
        subtitle="Esta ação ficará destacada no histórico como exceção."
        onClose={() => {
          setConfirmationCheck(null)
          setExceptionReason('')
        }}
      >
        {confirmationCheck ? (
          <div className="exception-confirmation">
            <div className="alert alert--danger">
              <ShieldAlert aria-hidden="true" />
              <div>
                <strong>{confirmationCheck.luggage?.code} · {confirmationCheck.passenger?.fullName}</strong>
                <p>{confirmationCheck.message}</p>
              </div>
            </div>
            <label className="field">
              <span>Justificativa obrigatória</span>
              <textarea
                value={exceptionReason}
                onChange={(event) => setExceptionReason(event.target.value)}
                placeholder="Explique por que a bagagem deve seguir nesta etapa mesmo assim."
                rows={4}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => { setConfirmationCheck(null); setExceptionReason('') }}>Voltar e corrigir</button>
              <button type="button" className="danger-button" disabled={!exceptionReason.trim() || processingCode} onClick={() => void handleConfirmException()}>
                Confirmar exceção
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={finalizeOpen}
        title="Conferência final da etapa"
        subtitle={definition.title}
        onClose={() => setFinalizeOpen(false)}
        size="large"
      >
        <div className="finalize-operation-layout">
          <div className={`finalize-status ${hasFinalizeIssues ? 'has-issues' : 'is-clear'}`}>
            {hasFinalizeIssues ? <AlertTriangle /> : <CheckCircle2 />}
            <div>
              <strong>{hasFinalizeIssues ? 'Existem itens para conferir' : 'Todos os volumes esperados foram conferidos'}</strong>
              <p>{hasFinalizeIssues ? 'Você pode voltar para corrigir ou finalizar com uma justificativa.' : 'A etapa pode ser finalizada sem divergências.'}</p>
            </div>
          </div>

          <div className="finalize-issue-grid">
            <FinalizeIssue label="Bagagens restantes" value={snapshot.pendingLuggage} />
            <FinalizeIssue label="Fora do fluxo" value={snapshot.unexpectedLuggage} />
            <FinalizeIssue label="Bagagens conferidas" value={snapshot.completedLuggage} positive />
          </div>

          <label className="field">
            <span>{hasFinalizeIssues ? 'Justificativa obrigatória para finalizar' : 'Observação da conferência (opcional)'}</span>
            <textarea
              value={finalizeNote}
              onChange={(event) => setFinalizeNote(event.target.value)}
              placeholder={hasFinalizeIssues ? 'Ex.: Passageiro confirmou que viajará sem bagagem; volume não foi entregue ao galpão.' : 'Registre algo relevante sobre esta etapa.'}
              rows={4}
            />
          </label>

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => setFinalizeOpen(false)}>Voltar para corrigir</button>
            <button
              type="button"
              className={hasFinalizeIssues ? 'danger-button' : 'primary-button'}
              disabled={finalizing || (hasFinalizeIssues && !finalizeNote.trim())}
              onClick={() => void handleFinalize()}
            >
              {finalizing ? <LoaderCircle className="spin" /> : <ShieldCheck />}
              {hasFinalizeIssues ? 'Finalizar com divergências' : 'Finalizar etapa'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(photoViewer)}
        title={photoViewer?.title ?? 'Fotografia'}
        onClose={() => setPhotoViewer(null)}
        size="large"
      >
        <div className="photo-viewer">
          {photoViewer ? <img src={photoViewer.url} alt={photoViewer.title} /> : null}
        </div>
      </Modal>
    </div>
  )
}

function OperationSummaryCard({
  label,
  value,
  icon,
  tone = 'blue',
  active,
  onClick,
}: {
  label: string
  value: number
  icon: ReactNode
  tone?: 'blue' | 'green' | 'amber' | 'red'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`operation-summary-card tone-${tone} ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={`Mostrar ${label.toLocaleLowerCase('pt-BR')}`}
    >
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}

function OperationPassengerCard({ group, onOpen }: { group: OperationPassengerGroup; onOpen: () => void }) {
  const periodClass = `period-${group.passenger.travelPeriod.toLowerCase()}`
  const isComplete = group.totalCount > 0 && group.pendingCount === 0 && group.unexpectedCount === 0

  return (
    <article className={`operation-passenger-card operation-passenger-card--selectable ${isComplete ? 'is-complete' : ''}`}>
      <div className="operation-passenger-card__select-header">
        <div className="operation-passenger-card__identity">
          <div className="passenger-avatar">{group.passenger.fullName.slice(0, 1).toLocaleUpperCase('pt-BR')}</div>
          <div>
            <h3>{group.passenger.fullName}</h3>
            <div className="badge-row">
              <span className="info-badge"><MapPin />{group.passenger.city}</span>
              <span className={`period-badge ${periodClass}`}>{TRAVEL_PERIOD_LABELS[group.passenger.travelPeriod]}</span>
            </div>
          </div>
        </div>
        <div className="operation-passenger-card__progress operation-passenger-card__progress--plain">
          <strong>{group.completedCount}/{group.totalCount}</strong>
          <span>conferidas</span>
        </div>
      </div>

      <div className="operation-passenger-card__body">
        {group.totalCount === 0 ? (
          <div className="operation-zero-luggage"><AlertTriangle /> Nenhuma bagagem cadastrada para este passageiro.</div>
        ) : (
          <div className="operation-passenger-stage-summary">
            <span className={group.pendingCount > 0 ? 'has-pending' : 'is-clear'}>
              {group.pendingCount} {group.pendingCount === 1 ? 'restante' : 'restantes'}
            </span>
            {group.unexpectedCount > 0 ? <span className="has-unexpected">{group.unexpectedCount} fora do fluxo</span> : null}
          </div>
        )}
        <button type="button" className="primary-button operation-open-passenger-button" onClick={onOpen} disabled={group.totalCount === 0}>
          <Camera aria-hidden="true" />
          {group.unexpectedCount > 0
            ? 'Revisar divergência'
            : isComplete
              ? 'Revisar passageiro'
              : 'Conferir este passageiro'}
        </button>
      </div>
    </article>
  )
}

function FinalizeIssue({ label, value, positive = false }: { label: string; value: number; positive?: boolean }) {
  return (
    <article className={`finalize-issue ${positive ? 'is-positive' : value > 0 ? 'has-value' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
