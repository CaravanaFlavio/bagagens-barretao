import {
  AlertTriangle,
  Barcode,
  BriefcaseBusiness,
  CheckCircle2,
  Database,
  Download,
  Camera,
  ChevronDown,
  Clock3,
  Edit3,
  Eye,
  FileClock,
  FileSpreadsheet,
  History,
  ImageOff,
  LoaderCircle,
  MapPin,
  PackagePlus,
  Phone,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { Modal } from '../components/Modal'
import { PhotoCaptureButtons } from '../components/PhotoCaptureButtons'
import { CITIES, LABEL_COLORS } from '../constants/cities'
import { STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS, TRAVEL_PERIOD_OPTIONS } from '../constants/travelPeriods'
import {
  createLuggage,
  deleteLuggagePermanently,
  deletePassengerPermanently,
  deletePhoto,
  getPassengerImport2026Status,
  getPassengerSetPhoto,
  getPhotosByIds,
  listLuggageByPassenger,
  listLuggageMovements,
  listLuggagePhotosByPassenger,
  listLuggageWithPassengers,
  importPassengers2026,
  applyPassengerPdfUpdate,
  listPassengerImportBatches,
  previewPassengerPdfUpdate,
  listPassengers,
  saveLuggagePhoto,
  savePassenger,
  savePassengerSetPhoto,
} from '../data/repository'
import type {
  CodeSource,
  Luggage,
  LuggageInput,
  LuggageMovement,
  LuggageStage,
  Passenger,
  PassengerImport2026Status,
  PassengerImportBatch,
  PassengerInput,
  PassengerUpdatePreview,
  PassengerUpdateStatus,
  PassengerSummary,
  PhotoRecord,
  TravelPeriod,
} from '../domain/types'
import { compressPhoto } from '../utils/imageCompression'
import { parsePassengerUpdatePdfs } from '../utils/passengerPdfImport'
import { parsePassengerUpdateExcel } from '../utils/passengerExcelImport'
import { createPassengerWorkbook } from '../utils/passengerWorkbook'
import { downloadBlobFile } from '../utils/fileDownload'
import { isNativeAndroidPrint, printCurrentDocument } from '../utils/nativePrint'
import {
  createQrSvgDataUrl,
  downloadQrSvg,
  luggageQrValue,
  passengerQrValue,
} from '../utils/operationalQr'

const emptyPassengerForm: PassengerInput = {
  fullName: '',
  city: '',
  phone: '',
  travelPeriod: 'FIRST_WEEK',
  documentNumber: '',
  documentType: 'UNKNOWN',
  busType: 'UNSPECIFIED',
  reviewStatus: 'CONFIRMED',
  notes: '',
}

const DOCUMENT_TYPE_LABELS = {
  CPF: 'CPF',
  RG: 'RG',
  UNKNOWN: 'Não identificado',
} as const

const BUS_TYPE_LABELS = {
  DOUBLE_DECKER: 'Ônibus 2 andares',
  CONVENTIONAL: 'Ônibus convencional',
  UNSPECIFIED: 'Ônibus não informado',
} as const

const PRINT_PERIOD_ORDER: TravelPeriod[] = [
  'FIRST_WEEK',
  'SECOND_WEEK',
  'BOTH_WEEKS',
]

const PRINT_BUS_ORDER: PassengerSummary['busType'][] = [
  'DOUBLE_DECKER',
  'CONVENTIONAL',
  'UNSPECIFIED',
]

const UPDATE_STATUS_LABELS: Record<PassengerUpdateStatus, string> = {
  NEW: 'Novo',
  CHANGED: 'Alterado',
  UNCHANGED: 'Sem mudança',
  CONFLICT: 'Conflito',
}

type LabelMode = 'PASSENGER' | 'LUGGAGE'
type LuggageEntryMode = 'QUICK_SET' | 'INDIVIDUAL'

type LuggageLabelRecord = Awaited<ReturnType<typeof listLuggageWithPassengers>>[number]

interface LabelPrintItem {
  id: string
  kind: LabelMode
  qrValue: string
  passengerName: string
  city: string
  travelPeriod: TravelPeriod
  busType: PassengerSummary['busType']
  luggageCode?: string
  luggageType?: string
  volumePosition?: string
}


const emptyLuggageForm: Omit<LuggageInput, 'passengerId'> = {
  code: '',
  codeSource: 'MANUAL',
  labelColor: '',
  luggageType: 'Mala',
  notes: '',
}

const AUTOMATIC_LUGGAGE_PREFIX = 'SEM-LACRE-'

function isAutomaticLuggageCode(code: string) {
  return code.startsWith(AUTOMATIC_LUGGAGE_PREFIX)
}

function luggageDisplayCode(code: string) {
  return isAutomaticLuggageCode(code) ? 'Sem lacre físico' : code
}

function createAutomaticLuggageCode(passengerId: string, position: number) {
  const passengerToken = passengerId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toLocaleUpperCase('pt-BR') || 'PASS'
  const timeToken = Date.now().toString(36).toLocaleUpperCase('pt-BR')
  const randomToken = Math.random().toString(36).slice(2, 7).toLocaleUpperCase('pt-BR')
  return `${AUTOMATIC_LUGGAGE_PREFIX}${passengerToken}-${timeToken}-${position}-${randomToken}`
}

const MOVEMENT_LABELS: Record<LuggageMovement['type'], string> = {
  REGISTERED_AT_WAREHOUSE: 'Recebida no galpão',
  WAREHOUSE_TO_TRAILER: 'Galpão → carreta',
  TRAILER_TO_PASSENGER: 'Carreta → passageiro',
  PASSENGER_TO_TRAILER: 'Passageiro → carreta',
  TRAILER_TO_WAREHOUSE: 'Carreta → galpão',
  WAREHOUSE_TO_CITY: 'Galpão → cidade',
}

const PASSENGER_STAGE_ORDER: LuggageStage[] = [
  'WAREHOUSE_INITIAL',
  'TRAILER_OUTBOUND',
  'WITH_PASSENGER',
  'TRAILER_RETURN',
  'WAREHOUSE_RETURN',
  'DELIVERED_TO_CITY',
]

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileNamePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function passengerLabelItem(passenger: PassengerSummary | Passenger): LabelPrintItem {
  return {
    id: `passenger-${passenger.id}`,
    kind: 'PASSENGER',
    qrValue: passengerQrValue(passenger.id, {
      fullName: passenger.fullName,
      city: passenger.city,
      travelPeriod: TRAVEL_PERIOD_LABELS[passenger.travelPeriod],
      busType: BUS_TYPE_LABELS[passenger.busType],
    }),
    passengerName: passenger.fullName,
    city: passenger.city,
    travelPeriod: passenger.travelPeriod,
    busType: passenger.busType,
  }
}

function luggageLabelItem(
  luggage: Luggage,
  passenger: PassengerSummary | Passenger,
  position?: string,
): LabelPrintItem {
  return {
    id: `luggage-${luggage.id}`,
    kind: 'LUGGAGE',
    qrValue: luggageQrValue(luggage.id, {
      fullName: passenger.fullName,
      city: passenger.city,
      travelPeriod: TRAVEL_PERIOD_LABELS[passenger.travelPeriod],
      busType: BUS_TYPE_LABELS[passenger.busType],
      code: luggage.code,
      luggageType: luggage.luggageType,
      volumePosition: position,
    }),
    passengerName: passenger.fullName,
    city: passenger.city,
    travelPeriod: passenger.travelPeriod,
    busType: passenger.busType,
    luggageCode: luggage.code,
    luggageType: luggage.luggageType,
    volumePosition: position,
  }
}

export function PassengersPage() {
  const [passengers, setPassengers] = useState<PassengerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [query, setQuery] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState<TravelPeriod | ''>('')
  const [reviewOnly, setReviewOnly] = useState(
    () => new URLSearchParams(window.location.search).get('revisar') === '1',
  )
  const [importStatus, setImportStatus] = useState<PassengerImport2026Status | null>(null)
  const [importingPassengers, setImportingPassengers] = useState(false)
  const [importFeedback, setImportFeedback] = useState('')
  const [importBatches, setImportBatches] = useState<PassengerImportBatch[]>([])
  const [importHistoryOpen, setImportHistoryOpen] = useState(false)
  const [updatePreview, setUpdatePreview] = useState<PassengerUpdatePreview | null>(null)
  const [updateFilter, setUpdateFilter] = useState<PassengerUpdateStatus | 'ALL'>('ALL')
  const [parsingUpdate, setParsingUpdate] = useState(false)
  const [parsingExcel, setParsingExcel] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [applyingUpdate, setApplyingUpdate] = useState(false)
  const [updateError, setUpdateError] = useState('')

  const [passengerModalOpen, setPassengerModalOpen] = useState(false)
  const [editingPassenger, setEditingPassenger] = useState<PassengerSummary | null>(null)
  const [passengerForm, setPassengerForm] = useState<PassengerInput>(emptyPassengerForm)
  const [passengerFormError, setPassengerFormError] = useState('')
  const [savingPassenger, setSavingPassenger] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PassengerSummary | null>(null)
  const [deletingPassenger, setDeletingPassenger] = useState(false)

  const [luggagePassenger, setLuggagePassenger] = useState<PassengerSummary | null>(null)
  const [luggage, setLuggage] = useState<Luggage[]>([])
  const [luggageEntryMode, setLuggageEntryMode] = useState<LuggageEntryMode>('QUICK_SET')
  const [quickVolumeCount, setQuickVolumeCount] = useState(1)
  const [luggageForm, setLuggageForm] = useState(emptyLuggageForm)
  const [luggageFormError, setLuggageFormError] = useState('')
  const [savingLuggage, setSavingLuggage] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const [labelCenterOpen, setLabelCenterOpen] = useState(false)
  const [labelMode, setLabelMode] = useState<LabelMode>('PASSENGER')
  const [labelLuggage, setLabelLuggage] = useState<LuggageLabelRecord[]>([])
  const [labelLoading, setLabelLoading] = useState(false)
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(() => new Set())
  const [labelPrintItems, setLabelPrintItems] = useState<LabelPrintItem[]>([])
  const [labelPrintTitle, setLabelPrintTitle] = useState('')

  const [setPhoto, setSetPhoto] = useState<PhotoRecord | null>(null)
  const [luggagePhotos, setLuggagePhotos] = useState<Record<string, PhotoRecord>>({})
  const [photoBusyKey, setPhotoBusyKey] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [photoViewer, setPhotoViewer] = useState<{ title: string; url: string } | null>(null)

  const [historyTarget, setHistoryTarget] = useState<Luggage | null>(null)
  const [historyMovements, setHistoryMovements] = useState<LuggageMovement[]>([])
  const [historyPhotos, setHistoryPhotos] = useState<PhotoRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadPassengers = useCallback(async () => {
    try {
      setPageError('')
      const [result, currentImportStatus, batches] = await Promise.all([
        listPassengers(),
        getPassengerImport2026Status(),
        listPassengerImportBatches(),
      ])
      setPassengers(result)
      setImportStatus(currentImportStatus)
      setImportBatches(batches)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Não foi possível carregar os passageiros.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPassengers()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadPassengers])

  const setPhotoUrl = useMemo(
    () => (setPhoto ? URL.createObjectURL(setPhoto.blob) : ''),
    [setPhoto],
  )

  const luggagePhotoUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    for (const [luggageId, photo] of Object.entries(luggagePhotos)) {
      urls[luggageId] = URL.createObjectURL(photo.blob)
    }
    return urls
  }, [luggagePhotos])

  const historyPhotoUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    for (const photo of historyPhotos) {
      urls[photo.id] = URL.createObjectURL(photo.blob)
    }
    return urls
  }, [historyPhotos])

  useEffect(() => {
    if (!setPhotoUrl) return
    return () => URL.revokeObjectURL(setPhotoUrl)
  }, [setPhotoUrl])

  useEffect(() => {
    return () => {
      Object.values(luggagePhotoUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [luggagePhotoUrls])

  useEffect(() => {
    return () => {
      Object.values(historyPhotoUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [historyPhotoUrls])

  const filteredPassengers = useMemo(() => {
    const normalizedQuery = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleUpperCase('pt-BR')

    const queryDigits = normalizedQuery.replace(/\D/g, '')
    const queryDocument = normalizedQuery.replace(/[^A-Z0-9]/g, '')

    return passengers.filter((passenger) => {
      const documentSearch = passenger.documentNumber
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLocaleUpperCase('pt-BR')
        .replace(/[^A-Z0-9]/g, '')
      const matchesQuery =
        !normalizedQuery ||
        passenger.normalizedName.includes(normalizedQuery) ||
        (queryDigits.length > 0 && passenger.phone.replace(/\D/g, '').includes(queryDigits)) ||
        (queryDocument.length > 0 && documentSearch.includes(queryDocument))
      const matchesCity = !cityFilter || passenger.city === cityFilter
      const matchesPeriod = !periodFilter || passenger.travelPeriod === periodFilter
      const matchesReview = !reviewOnly || passenger.reviewStatus === 'REVIEW'
      return matchesQuery && matchesCity && matchesPeriod && matchesReview
    })
  }, [cityFilter, passengers, periodFilter, query, reviewOnly])

  const reviewCount = useMemo(
    () => passengers.filter((passenger) => passenger.reviewStatus === 'REVIEW').length,
    [passengers],
  )

  const printSummary = useMemo(() => ({
    firstWeek: filteredPassengers.filter((passenger) => passenger.travelPeriod === 'FIRST_WEEK').length,
    secondWeek: filteredPassengers.filter((passenger) => passenger.travelPeriod === 'SECOND_WEEK').length,
    bothWeeks: filteredPassengers.filter((passenger) => passenger.travelPeriod === 'BOTH_WEEKS').length,
    review: filteredPassengers.filter((passenger) => passenger.reviewStatus === 'REVIEW').length,
  }), [filteredPassengers])

  const printGroups = useMemo(
    () =>
      PRINT_PERIOD_ORDER.map((travelPeriod) => {
        const periodPassengers = filteredPassengers.filter(
          (passenger) => passenger.travelPeriod === travelPeriod,
        )

        const buses = PRINT_BUS_ORDER.map((busType) => {
          const busPassengers = periodPassengers.filter(
            (passenger) => passenger.busType === busType,
          )
          const cities = Array.from(
            new Set(busPassengers.map((passenger) => passenger.city)),
          )
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
            .map((city) => ({
              city,
              passengers: busPassengers
                .filter((passenger) => passenger.city === city)
                .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR')),
            }))

          return {
            busType,
            count: busPassengers.length,
            cities,
          }
        }).filter((group) => group.count > 0)

        return {
          travelPeriod,
          count: periodPassengers.length,
          buses,
        }
      }).filter((group) => group.count > 0),
    [filteredPassengers],
  )

  const visibleUpdateItems = useMemo(() => {
    if (!updatePreview) return []
    if (updateFilter === 'ALL') return updatePreview.items
    return updatePreview.items.filter((item) => item.status === updateFilter)
  }, [updateFilter, updatePreview])

  const filteredPassengerIds = useMemo(
    () => new Set(filteredPassengers.map((passenger) => passenger.id)),
    [filteredPassengers],
  )

  const visibleLabelLuggage = useMemo(
    () => labelLuggage.filter((item) => filteredPassengerIds.has(item.passenger.id)),
    [filteredPassengerIds, labelLuggage],
  )

  const luggagePositions = useMemo(() => {
    const byPassenger = new Map<string, LuggageLabelRecord[]>()
    for (const item of labelLuggage) {
      const current = byPassenger.get(item.passenger.id) ?? []
      current.push(item)
      byPassenger.set(item.passenger.id, current)
    }

    const positions = new Map<string, string>()
    for (const items of byPassenger.values()) {
      items.sort((a, b) => a.luggage.createdAt.localeCompare(b.luggage.createdAt))
      items.forEach((item, index) => {
        positions.set(item.luggage.id, `Volume ${index + 1} de ${items.length}`)
      })
    }
    return positions
  }, [labelLuggage])

  const currentLabelIds = useMemo(
    () =>
      labelMode === 'PASSENGER'
        ? filteredPassengers.map((passenger) => passenger.id)
        : visibleLabelLuggage.map((item) => item.luggage.id),
    [filteredPassengers, labelMode, visibleLabelLuggage],
  )

  const selectedVisibleCount = useMemo(
    () => currentLabelIds.filter((id) => selectedLabelIds.has(id)).length,
    [currentLabelIds, selectedLabelIds],
  )

  const labelPages = useMemo(() => chunkItems(labelPrintItems, 8), [labelPrintItems])

  useEffect(() => {
    if (labelPrintItems.length === 0 || !labelPrintTitle) return

    const previousTitle = document.title
    const nativeAndroid = isNativeAndroidPrint()
    document.body.classList.add('printing-qr-labels')
    document.title = labelPrintTitle

    let restored = false
    let focusRestoreTimer: number | undefined

    const restore = () => {
      if (restored) return
      restored = true
      document.title = previousTitle
      document.body.classList.remove('printing-qr-labels')
      setLabelPrintItems([])
      setLabelPrintTitle('')
      window.removeEventListener('afterprint', restore)
      window.removeEventListener('focus', handleFocus)
      if (focusRestoreTimer !== undefined) {
        window.clearTimeout(focusRestoreTimer)
      }
    }

    const handleFocus = () => {
      if (!nativeAndroid) return
      focusRestoreTimer = window.setTimeout(restore, 250)
    }

    if (nativeAndroid) {
      window.addEventListener('focus', handleFocus)
    } else {
      window.addEventListener('afterprint', restore)
    }

    const timeoutId = window.setTimeout(() => {
      void printCurrentDocument(labelPrintTitle).catch((error) => {
        setPageError(
          error instanceof Error
            ? error.message
            : 'Não foi possível abrir a impressão das etiquetas.',
        )
        restore()
      })
    }, 120)

    const safetyTimeoutId = nativeAndroid
      ? window.setTimeout(restore, 120_000)
      : undefined

    return () => {
      window.clearTimeout(timeoutId)
      if (safetyTimeoutId !== undefined) {
        window.clearTimeout(safetyTimeoutId)
      }
      window.removeEventListener('afterprint', restore)
      window.removeEventListener('focus', handleFocus)
      if (focusRestoreTimer !== undefined) {
        window.clearTimeout(focusRestoreTimer)
      }
      document.title = previousTitle
      document.body.classList.remove('printing-qr-labels')
    }
  }, [labelPrintItems.length, labelPrintTitle])

  const loadLabelLuggage = async () => {
    try {
      setLabelLoading(true)
      const result = await listLuggageWithPassengers()
      setLabelLuggage(result)
      return result
    } finally {
      setLabelLoading(false)
    }
  }

  const openLabelCenter = async (mode: LabelMode = 'PASSENGER') => {
    setLabelMode(mode)
    setSelectedLabelIds(new Set())
    setLabelCenterOpen(true)
    if (mode === 'LUGGAGE') {
      await loadLabelLuggage()
    }
  }

  const changeLabelMode = async (mode: LabelMode) => {
    setLabelMode(mode)
    setSelectedLabelIds(new Set())
    if (mode === 'LUGGAGE') {
      await loadLabelLuggage()
    }
  }

  const toggleLabelSelection = (id: string) => {
    setSelectedLabelIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisibleLabels = () => {
    setSelectedLabelIds(new Set(currentLabelIds))
  }

  const buildBulkLabelItems = (onlySelected: boolean) => {
    if (labelMode === 'PASSENGER') {
      return filteredPassengers
        .filter((passenger) => !onlySelected || selectedLabelIds.has(passenger.id))
        .map(passengerLabelItem)
    }

    return visibleLabelLuggage
      .filter((item) => !onlySelected || selectedLabelIds.has(item.luggage.id))
      .map((item) =>
        luggageLabelItem(
          item.luggage,
          item.passenger,
          luggagePositions.get(item.luggage.id),
        ),
      )
  }

  const printQrLabels = (items: LabelPrintItem[], titleSuffix: string) => {
    if (items.length === 0) return

    setLabelPrintItems(items.map((item) => ({ ...item })))
    setLabelPrintTitle(`Etiquetas_QR_Barretao_2026_${fileNamePart(titleSuffix)}`)
  }

  const printSinglePassengerLabel = (passenger: PassengerSummary) => {
    printQrLabels([passengerLabelItem(passenger)], `Passageiro_${passenger.fullName}`)
  }

  const printSingleLuggageLabel = (item: Luggage, passenger: PassengerSummary, passengerLuggage: Luggage[]) => {
    const sorted = [...passengerLuggage].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const index = sorted.findIndex((candidate) => candidate.id === item.id)
    const position = index >= 0 ? `Volume ${index + 1} de ${sorted.length}` : undefined
    printQrLabels(
      [luggageLabelItem(item, passenger, position)],
      `Volume_${passenger.fullName}_${item.code}`,
    )
  }

  const downloadSelectedQr = async () => {
    const items = buildBulkLabelItems(true)
    if (items.length !== 1) return

    const item = items[0]
    const suffix = item.kind === 'PASSENGER'
      ? `Passageiro_${item.passengerName}`
      : `Volume_${item.passengerName}_${item.luggageCode ?? item.id}`

    try {
      setPageError('')
      const result = await downloadQrSvg(
        item.qrValue,
        `QR_Barretao_2026_${fileNamePart(suffix)}.svg`,
      )
      if (result.native && result.displayPath) {
        window.alert(`QR salvo no celular em ${result.displayPath}`)
      }
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível baixar o QR selecionado.',
      )
    }
  }

  const openNewPassenger = () => {
    setEditingPassenger(null)
    setPassengerForm(emptyPassengerForm)
    setPassengerFormError('')
    setPassengerModalOpen(true)
  }

  const openEditPassenger = (passenger: PassengerSummary) => {
    setEditingPassenger(passenger)
    setPassengerForm({
      fullName: passenger.fullName,
      city: passenger.city,
      phone: passenger.phone,
      travelPeriod: passenger.travelPeriod,
      documentNumber: passenger.documentNumber,
      documentType: passenger.documentType,
      busType: passenger.busType,
      reviewStatus: passenger.reviewStatus,
      notes: passenger.notes,
    })
    setPassengerFormError('')
    setPassengerModalOpen(true)
  }

  const openReviewPassenger = (passenger: PassengerSummary) => {
    setEditingPassenger(passenger)
    setPassengerForm({
      fullName: passenger.fullName,
      city: passenger.city,
      phone: passenger.phone,
      travelPeriod: passenger.travelPeriod,
      documentNumber: passenger.documentNumber,
      documentType: passenger.documentType,
      busType: passenger.busType,
      reviewStatus: 'CONFIRMED',
      notes: passenger.notes,
    })
    setPassengerFormError('')
    setPassengerModalOpen(true)
  }

  const handlePassengerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!passengerForm.fullName.trim()) {
      setPassengerFormError('Informe o nome do passageiro.')
      return
    }
    if (!passengerForm.city) {
      setPassengerFormError('Selecione a cidade de embarque.')
      return
    }

    try {
      setSavingPassenger(true)
      setPassengerFormError('')
      await savePassenger(passengerForm, editingPassenger?.id)
      setPassengerModalOpen(false)
      await loadPassengers()
    } catch (error) {
      setPassengerFormError(error instanceof Error ? error.message : 'Não foi possível salvar o passageiro.')
    } finally {
      setSavingPassenger(false)
    }
  }

  const handleImportPassengers = async () => {
    const confirmed = window.confirm(
      'Importar a lista provisória de 2026? Os passageiros que já existem no aplicativo serão preservados. A lista será adicionada uma única vez e os registros duvidosos ficarão marcados para revisão.',
    )
    if (!confirmed) return

    try {
      setImportingPassengers(true)
      setImportFeedback('')
      const result = await importPassengers2026()
      setImportFeedback(
        result.alreadyCompleted
          ? 'A lista provisória de 2026 já havia sido importada neste aparelho.'
          : `${result.insertedCount} registros importados. ${result.reviewCount} ficaram marcados para revisão.`,
      )
      await loadPassengers()
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível importar a lista provisória de passageiros.',
      )
    } finally {
      setImportingPassengers(false)
    }
  }


  const handleUpdateFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []) as File[]
    event.currentTarget.value = ''
    if (files.length === 0) return

    try {
      setParsingUpdate(true)
      setUpdateError('')
      setImportFeedback('')
      const parsed = await parsePassengerUpdatePdfs(files)
      const preview = await previewPassengerPdfUpdate(
        parsed.rows,
        parsed.fingerprint,
        parsed.fileNames,
      )
      setUpdateFilter('ALL')
      setUpdatePreview(preview)
    } catch (error) {
      setUpdateError(
        error instanceof Error
          ? error.message
          : 'Não foi possível interpretar a atualização em PDF.',
      )
    } finally {
      setParsingUpdate(false)
    }
  }

  const handleExcelUpdateFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    try {
      setParsingExcel(true)
      setUpdateError('')
      setImportFeedback('')
      const parsed = await parsePassengerUpdateExcel(file)
      const preview = await previewPassengerPdfUpdate(
        parsed.rows,
        parsed.fingerprint,
        parsed.fileNames,
      )
      setUpdateFilter('ALL')
      setUpdatePreview(preview)
    } catch (error) {
      setUpdateError(
        error instanceof Error
          ? error.message
          : 'Não foi possível interpretar a atualização em Excel.',
      )
    } finally {
      setParsingExcel(false)
    }
  }

  const handleExportExcel = async () => {
    if (filteredPassengers.length === 0) return

    try {
      setExportingExcel(true)
      setPageError('')
      const { buffer, fileName } = await createPassengerWorkbook(filteredPassengers, {
        city: cityFilter,
        travelPeriod: periodFilter,
        reviewOnly,
        query,
      })
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const downloadResult = await downloadBlobFile(blob, fileName)
      if (downloadResult.native && downloadResult.displayPath) {
        window.alert(`Planilha salva no celular em ${downloadResult.displayPath}`)
      }
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível gerar a planilha Excel de passageiros.',
      )
    } finally {
      setExportingExcel(false)
    }
  }

  const handleApplyUpdate = async () => {
    if (!updatePreview || updatePreview.alreadyImportedAt) return
    const confirmed = window.confirm(
      `Confirmar esta atualização? ${updatePreview.newCount} novos cadastros serão incluídos e ${updatePreview.changedCount} cadastros serão atualizados. Conflitos não terão dados substituídos automaticamente.`,
    )
    if (!confirmed) return

    try {
      setApplyingUpdate(true)
      setUpdateError('')
      const result = await applyPassengerPdfUpdate(updatePreview)
      setImportFeedback(
        `Atualização aplicada: ${result.insertedCount} novos, ${result.updatedCount} alterados e ${result.conflictCount} conflitos encaminhados para revisão.`,
      )
      setUpdatePreview(null)
      await loadPassengers()
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : 'Não foi possível aplicar a atualização.',
      )
    } finally {
      setApplyingUpdate(false)
    }
  }

  const handlePrintPassengers = () => {
    if (filteredPassengers.length === 0) return

    const previousTitle = document.title
    const nameParts = ['Lista', 'Passageiros', 'Barretao', '2026']

    if (periodFilter) {
      nameParts.push(fileNamePart(TRAVEL_PERIOD_LABELS[periodFilter]))
    }
    if (cityFilter) {
      nameParts.push(fileNamePart(cityFilter))
    }
    if (reviewOnly) {
      nameParts.push('Revisar')
    }
    if (query.trim()) {
      nameParts.push('Filtrada')
    }
    if (!periodFilter && !cityFilter && !reviewOnly && !query.trim()) {
      nameParts.push('Completa')
    }

    const jobName = nameParts.filter(Boolean).join('_')
    document.title = jobName

    if (isNativeAndroidPrint()) {
      void printCurrentDocument(jobName)
        .catch((error) => {
          setPageError(
            error instanceof Error
              ? error.message
              : 'Não foi possível abrir a impressão da lista.',
          )
        })
        .finally(() => {
          document.title = previousTitle
        })
      return
    }

    const restoreTitle = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restoreTitle)
    }
    window.addEventListener('afterprint', restoreTitle)
    void printCurrentDocument(jobName)
  }

  const handleDeletePassenger = async () => {
    if (!deleteTarget) return

    try {
      setDeletingPassenger(true)
      await deletePassengerPermanently(deleteTarget.id)
      setDeleteTarget(null)
      await loadPassengers()
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Não foi possível excluir o passageiro.')
    } finally {
      setDeletingPassenger(false)
    }
  }

  const loadLuggageWorkspace = useCallback(async (passengerId: string) => {
    const [luggageResult, setPhotoResult, individualPhotos] = await Promise.all([
      listLuggageByPassenger(passengerId),
      getPassengerSetPhoto(passengerId),
      listLuggagePhotosByPassenger(passengerId),
    ])

    setLuggage(luggageResult)
    setSetPhoto(setPhotoResult ?? null)
    setLuggagePhotos(
      Object.fromEntries(
        individualPhotos
          .filter((photo) => photo.luggageId)
          .map((photo) => [photo.luggageId as string, photo]),
      ),
    )
  }, [])

  const openLuggage = async (passenger: PassengerSummary) => {
    setLuggagePassenger(passenger)
    setLuggageEntryMode('QUICK_SET')
    setQuickVolumeCount(1)
    setLuggageForm(emptyLuggageForm)
    setLuggageFormError('')
    setPhotoError('')
    await loadLuggageWorkspace(passenger.id)
  }

  const refreshLuggage = async () => {
    if (!luggagePassenger) return
    await loadLuggageWorkspace(luggagePassenger.id)
  }

  const handleLuggageSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!luggagePassenger) return

    if (luggageEntryMode === 'QUICK_SET') {
      if (!Number.isInteger(quickVolumeCount) || quickVolumeCount < 1 || quickVolumeCount > 99) {
        setLuggageFormError('Informe uma quantidade entre 1 e 99 volumes.')
        return
      }

      if (!setPhoto) {
        const continueWithoutPhoto = window.confirm(
          'A foto do conjunto ainda não foi tirada. Ela será a principal referência visual em Barretos. Deseja cadastrar os volumes mesmo assim?',
        )
        if (!continueWithoutPhoto) return
      }

      let createdCount = 0
      try {
        setSavingLuggage(true)
        setLuggageFormError('')

        for (let position = 1; position <= quickVolumeCount; position += 1) {
          const noteParts = [
            `Cadastro rápido por conjunto • volume ${position} de ${quickVolumeCount}`,
            luggageForm.notes.trim(),
          ].filter(Boolean)

          await createLuggage({
            passengerId: luggagePassenger.id,
            code: createAutomaticLuggageCode(luggagePassenger.id, position),
            codeSource: 'MANUAL',
            labelColor: 'Sem lacre',
            luggageType: 'Outro',
            notes: noteParts.join(' • '),
          })
          createdCount += 1
        }

        setQuickVolumeCount(1)
        setLuggageForm(emptyLuggageForm)
        await Promise.all([refreshLuggage(), loadPassengers()])
      } catch (error) {
        await Promise.all([refreshLuggage(), loadPassengers()])
        const baseMessage = error instanceof Error ? error.message : 'Não foi possível cadastrar o conjunto.'
        setLuggageFormError(
          createdCount > 0
            ? `${createdCount} de ${quickVolumeCount} volumes foram salvos antes da interrupção. Confira a lista ao lado antes de tentar novamente. ${baseMessage}`
            : baseMessage,
        )
      } finally {
        setSavingLuggage(false)
      }
      return
    }

    if (!luggageForm.code.trim()) {
      setLuggageFormError('Digite ou escaneie o código do lacre.')
      return
    }
    if (!luggageForm.labelColor.trim()) {
      setLuggageFormError('Informe a cor da etiqueta ou do lacre.')
      return
    }

    try {
      setSavingLuggage(true)
      setLuggageFormError('')
      await createLuggage({ ...luggageForm, passengerId: luggagePassenger.id })
      setLuggageForm(emptyLuggageForm)
      await Promise.all([refreshLuggage(), loadPassengers()])
    } catch (error) {
      setLuggageFormError(error instanceof Error ? error.message : 'Não foi possível cadastrar a bagagem.')
    } finally {
      setSavingLuggage(false)
    }
  }

  const handleDeleteLuggage = async (item: Luggage) => {
    const confirmed = window.confirm(
      `Excluir definitivamente a bagagem ${luggageDisplayCode(item.code)}, suas fotos e todo o histórico dela?`,
    )
    if (!confirmed) return

    await deleteLuggagePermanently(item.id)
    await Promise.all([refreshLuggage(), loadPassengers()])
  }

  const handleScannedCode = useCallback((code: string) => {
    setLuggageForm((current) => ({
      ...current,
      code,
      codeSource: 'SCANNER',
    }))
    setScannerOpen(false)
  }, [])

  const updateCodeSource = (source: CodeSource) => {
    setLuggageForm((current) => ({ ...current, codeSource: source }))
    if (source === 'SCANNER') setScannerOpen(true)
  }

  const handleSetPhoto = async (file: File) => {
    if (!luggagePassenger) return

    try {
      setPhotoBusyKey('set')
      setPhotoError('')
      const compressed = await compressPhoto(file)
      await savePassengerSetPhoto(luggagePassenger.id, compressed)
      await refreshLuggage()
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Não foi possível salvar a foto do conjunto.')
    } finally {
      setPhotoBusyKey(null)
    }
  }

  const handleLuggagePhoto = async (item: Luggage, file: File) => {
    if (!luggagePassenger) return

    try {
      setPhotoBusyKey(item.id)
      setPhotoError('')
      const compressed = await compressPhoto(file)
      await saveLuggagePhoto(luggagePassenger.id, item.id, compressed)
      await refreshLuggage()
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Não foi possível salvar a foto da bagagem.')
    } finally {
      setPhotoBusyKey(null)
    }
  }

  const removeSetPhoto = async () => {
    if (!setPhoto) return
    const confirmed = window.confirm('Remover a foto do conjunto de bagagens?')
    if (!confirmed) return

    await deletePhoto(setPhoto.id)
    await refreshLuggage()
  }

  const removeLuggagePhoto = async (item: Luggage) => {
    const photo = luggagePhotos[item.id]
    if (!photo) return
    const confirmed = window.confirm(`Remover a foto individual da bagagem ${luggageDisplayCode(item.code)}?`)
    if (!confirmed) return

    await deletePhoto(photo.id)
    await refreshLuggage()
  }

  const openHistory = async (item: Luggage) => {
    try {
      setHistoryTarget(item)
      setHistoryLoading(true)
      const movements = await listLuggageMovements(item.id)
      const photoIds = Array.from(new Set(movements.flatMap((movement) => movement.photoIds ?? [])))
      const photos = await getPhotosByIds(photoIds)
      setHistoryMovements(movements)
      setHistoryPhotos(photos)
    } finally {
      setHistoryLoading(false)
    }
  }

  const closeLuggageModal = () => {
    setLuggagePassenger(null)
    setLuggageEntryMode('QUICK_SET')
    setQuickVolumeCount(1)
    setLuggageForm(emptyLuggageForm)
    setLuggageFormError('')
    setSetPhoto(null)
    setLuggagePhotos({})
    setPhotoError('')
  }

  return (
    <div className="passengers-page">
      <section className="page-title-card">
        <div>
          <p className="eyebrow">Base da operação</p>
          <h2>Passageiros</h2>
          <p>Cadastre as pessoas antes das bagagens chegarem ao galpão.</p>
        </div>
        <div className="page-title-actions">
          <button type="button" className="secondary-button" onClick={() => void openLabelCenter('PASSENGER')}>
            <Printer aria-hidden="true" />
            Etiquetas QR
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleExportExcel()}
            disabled={filteredPassengers.length === 0 || exportingExcel}
          >
            {exportingExcel ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
            {exportingExcel ? 'Gerando Excel...' : 'Exportar Excel'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handlePrintPassengers}
            disabled={filteredPassengers.length === 0}
          >
            <Printer aria-hidden="true" />
            Imprimir lista
          </button>
          <button type="button" className="primary-button" onClick={openNewPassenger}>
            <Plus aria-hidden="true" />
            Novo passageiro
          </button>
        </div>
      </section>

      {importStatus ? (
        <section className={`passenger-import-card ${importStatus.completed ? 'is-complete' : 'is-pending'}`}>
          <div className="passenger-import-card__icon">
            {importStatus.completed ? <CheckCircle2 aria-hidden="true" /> : <Database aria-hidden="true" />}
          </div>
          <div className="passenger-import-card__content">
            <p className="eyebrow">Lista provisória 2026</p>
            <h3>{importStatus.completed ? 'Lista inicial já importada' : 'Importar passageiros recebidos da equipe'}</h3>
            <p>
              {importStatus.completed
                ? `${importStatus.sourceTotal} registros foram incorporados ao aplicativo. As correções agora podem ser feitas diretamente no cadastro.`
                : `${importStatus.sourceTotal} registros serão adicionados sem excluir os cadastros atuais. ${importStatus.sourceReviewTotal} já estão sinalizados para conferência.`}
            </p>
            {importStatus.completedAt ? (
              <small>Importação concluída em {formatDateTime(importStatus.completedAt)}.</small>
            ) : null}
            {importFeedback ? <strong className="passenger-import-feedback">{importFeedback}</strong> : null}
          </div>
          {!importStatus.completed ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleImportPassengers()}
              disabled={importingPassengers}
            >
              {importingPassengers ? <LoaderCircle className="spin" aria-hidden="true" /> : <Database aria-hidden="true" />}
              Importar {importStatus.sourceTotal} registros
            </button>
          ) : (
            <div className="passenger-import-actions">
              <label className={`secondary-button passenger-update-file-button ${parsingUpdate ? 'is-busy' : ''}`}>
                {parsingUpdate ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}
                {parsingUpdate ? 'Lendo PDF...' : 'Importar atualização PDF'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  disabled={parsingUpdate}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void handleUpdateFiles(event)}
                />
              </label>
              <label className={`secondary-button passenger-update-file-button ${parsingExcel ? 'is-busy' : ''}`}>
                {parsingExcel ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}
                {parsingExcel ? 'Lendo Excel...' : 'Importar atualização Excel'}
                <input
                  type="file"
                  accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx"
                  disabled={parsingExcel}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void handleExcelUpdateFile(event)}
                />
              </label>
              <button type="button" className="secondary-button" onClick={() => setImportHistoryOpen(true)}>
                <FileClock aria-hidden="true" />
                Histórico {importBatches.length > 0 ? `(${importBatches.length})` : ''}
              </button>
            </div>
          )}
        </section>
      ) : null}

      {updateError && !updatePreview ? <div className="alert alert--danger">{updateError}</div> : null}

      {reviewCount > 0 ? (
        <section className="passenger-review-alert">
          <div className="passenger-review-alert__icon"><AlertTriangle aria-hidden="true" /></div>
          <div>
            <p className="eyebrow">Passageiros → Revisar cadastros</p>
            <h3>{reviewCount} {reviewCount === 1 ? 'cadastro precisa' : 'cadastros precisam'} de conferência</h3>
            <p>Duplicidades, documentos incompletos ou outras divergências da lista provisória ficam reunidas aqui até serem confirmadas.</p>
          </div>
          <button
            type="button"
            className={reviewOnly ? 'secondary-button' : 'primary-button'}
            onClick={() => setReviewOnly((current) => !current)}
          >
            {reviewOnly ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            {reviewOnly ? 'Ver todos os passageiros' : 'Revisar cadastros'}
          </button>
        </section>
      ) : null}

      <section className="filter-card">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar nome, documento ou telefone"
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
            {CITIES.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>

        <label className="select-field">
          <BriefcaseBusiness aria-hidden="true" />
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value as TravelPeriod | '')}
          >
            <option value="">Todos os períodos</option>
            {TRAVEL_PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
      </section>

      <div className="list-summary">
        <strong>{filteredPassengers.length}</strong>
        <span>{filteredPassengers.length === 1 ? 'passageiro encontrado' : 'passageiros encontrados'}</span>
        {reviewOnly ? <em>Mostrando somente cadastros para revisar</em> : null}
      </div>

      {pageError ? <div className="alert alert--danger">{pageError}</div> : null}

      {loading ? (
        <div className="loading-state">
          <LoaderCircle className="spin" aria-hidden="true" />
          Carregando passageiros...
        </div>
      ) : filteredPassengers.length === 0 ? (
        <section className="empty-state">
          <UserRound aria-hidden="true" />
          <h3>Nenhum passageiro encontrado</h3>
          <p>Cadastre o primeiro passageiro ou ajuste os filtros da pesquisa.</p>
          <button type="button" className="primary-button" onClick={openNewPassenger}>
            <Plus aria-hidden="true" />
            Cadastrar passageiro
          </button>
        </section>
      ) : (
        <section className="passenger-grid">
          {filteredPassengers.map((passenger) => (
            <article className={`passenger-card ${passenger.reviewStatus === 'REVIEW' ? 'has-review' : ''}`} key={passenger.id}>
              <div className="passenger-card__header">
                <div className="passenger-avatar" aria-hidden="true">
                  {passenger.fullName.slice(0, 1).toLocaleUpperCase('pt-BR')}
                </div>
                <div className="passenger-card__identity">
                  <h3>{passenger.fullName}</h3>
                  <div className="badge-row">
                    <span className="info-badge"><MapPin />{passenger.city}</span>
                    <span className={`period-badge period-${passenger.travelPeriod.toLowerCase()}`}>
                      {TRAVEL_PERIOD_LABELS[passenger.travelPeriod]}
                    </span>
                    {passenger.sourceRole === 'GUIDE' ? (
                      <span className="passenger-role-badge">GUIA</span>
                    ) : null}
                    {passenger.reviewStatus === 'REVIEW' ? (
                      <span className="passenger-review-badge"><AlertTriangle aria-hidden="true" /> Revisar cadastro</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="passenger-card__body">
                <div className="passenger-detail">
                  <Barcode aria-hidden="true" />
                  <span>
                    {passenger.documentNumber
                      ? `${DOCUMENT_TYPE_LABELS[passenger.documentType]}: ${passenger.documentNumber}`
                      : 'Documento não informado'}
                  </span>
                </div>
                <div className="passenger-detail">
                  <BriefcaseBusiness aria-hidden="true" />
                  <span>{BUS_TYPE_LABELS[passenger.busType]}</span>
                </div>
                <div className="passenger-detail">
                  <Phone aria-hidden="true" />
                  <span>{passenger.phone || 'Telefone não informado'}</span>
                </div>
                <div className="luggage-total">
                  <BriefcaseBusiness aria-hidden="true" />
                  <strong>{passenger.luggageCount}</strong>
                  <span>{passenger.luggageCount === 1 ? 'bagagem cadastrada' : 'bagagens cadastradas'}</span>
                </div>

                {passenger.luggageCount > 0 ? (
                  <div className="passenger-stage-summary" aria-label="Situação atual das bagagens">
                    {PASSENGER_STAGE_ORDER.map((stage) => {
                      const count = passenger.luggageStageCounts[stage]
                      if (count === 0) return null
                      return (
                        <span className={`passenger-stage-chip stage-${stage.toLowerCase()}`} key={stage}>
                          <strong>{count}</strong>
                          {STAGE_LABELS[stage]}
                        </span>
                      )
                    })}
                  </div>
                ) : null}

                {passenger.luggageCount > 0 ? (
                  <button
                    type="button"
                    className="passenger-history-button"
                    onClick={() => void openLuggage(passenger)}
                  >
                    <History aria-hidden="true" />
                    Ver bagagens e histórico
                  </button>
                ) : null}

                {passenger.importWarning ? (
                  <div className={`passenger-import-warning ${passenger.reviewStatus === 'REVIEW' ? 'is-open' : 'is-resolved'}`}>
                    {passenger.reviewStatus === 'REVIEW' ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                    <div>
                      <strong>{passenger.reviewStatus === 'REVIEW' ? 'Alerta da lista original' : 'Alerta revisado'}</strong>
                      <p>{passenger.importWarning}</p>
                    </div>
                  </div>
                ) : null}
                {passenger.reviewStatus === 'REVIEW' ? (
                  <button
                    type="button"
                    className="passenger-review-confirm-button"
                    onClick={() => openReviewPassenger(passenger)}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    Revisar e confirmar cadastro
                  </button>
                ) : null}
                {passenger.importSourceFile ? (
                  <small className="passenger-import-source">
                    Origem: {passenger.importSourceFile}{passenger.importSourcePage ? ` • pág. ${passenger.importSourcePage}` : ''}
                  </small>
                ) : null}
                {passenger.lastUpdateSourceFile ? (
                  <small className="passenger-import-source">
                    Última atualização: {passenger.lastUpdateSourceFile}{passenger.lastUpdateSourcePage ? ` • pág. ${passenger.lastUpdateSourcePage}` : ''}
                  </small>
                ) : null}
                {passenger.notes ? <p className="passenger-notes">{passenger.notes}</p> : null}
              </div>

              <div className="passenger-card__actions">
                <button type="button" className="action-button action-button--primary" onClick={() => void openLuggage(passenger)}>
                  <PackagePlus aria-hidden="true" />
                  Incluir bagagem
                </button>
                <button type="button" className="action-button" onClick={() => printSinglePassengerLabel(passenger)}>
                  <Printer aria-hidden="true" />
                  Etiqueta QR
                </button>
                <button type="button" className="action-button" onClick={() => openEditPassenger(passenger)}>
                  <Edit3 aria-hidden="true" />
                  Editar
                </button>
                <button type="button" className="action-button action-button--danger" onClick={() => setDeleteTarget(passenger)}>
                  <Trash2 aria-hidden="true" />
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </section>
      )}


      <Modal
        open={labelCenterOpen}
        title="Etiquetas QR"
        subtitle="Impressão em A4 com 8 etiquetas por folha. A lista respeita os filtros atuais de Passageiros."
        onClose={() => {
          setLabelCenterOpen(false)
          setSelectedLabelIds(new Set())
        }}
      >
        <div className="qr-label-center">
          <div className="qr-label-mode-tabs" role="tablist" aria-label="Tipo de etiqueta">
            <button
              type="button"
              className={labelMode === 'PASSENGER' ? 'is-active' : ''}
              onClick={() => void changeLabelMode('PASSENGER')}
            >
              <UserRound aria-hidden="true" />
              Passageiros
            </button>
            <button
              type="button"
              className={labelMode === 'LUGGAGE' ? 'is-active' : ''}
              onClick={() => void changeLabelMode('LUGGAGE')}
            >
              <BriefcaseBusiness aria-hidden="true" />
              Volumes sem lacre
            </button>
          </div>

          <div className="qr-label-guidance">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{labelMode === 'PASSENGER' ? 'QR do passageiro' : 'Etiqueta reserva de volume'}</strong>
              <p>
                {labelMode === 'PASSENGER'
                  ? 'O QR mostra nome, cidade, semana e ônibus fora do app. Dentro do app, o scanner localiza o cadastro completo. CPF/RG não são gravados no QR.'
                  : 'Use somente no volume em que não for possível colocar o lacre físico. Fora do app, o QR mostra informações básicas; dentro do app, localiza o cadastro completo.'}
              </p>
            </div>
          </div>

          <div className="qr-label-toolbar">
            <div>
              <strong>
                {labelMode === 'PASSENGER' ? filteredPassengers.length : visibleLabelLuggage.length}
              </strong>
              <span>{labelMode === 'PASSENGER' ? 'passageiros disponíveis' : 'volumes disponíveis'}</span>
              <small>{selectedVisibleCount} selecionados</small>
            </div>
            <div>
              <button type="button" className="secondary-button" onClick={selectAllVisibleLabels} disabled={currentLabelIds.length === 0}>
                Selecionar todos
              </button>
              <button type="button" className="secondary-button" onClick={() => setSelectedLabelIds(new Set())} disabled={selectedVisibleCount === 0}>
                Limpar seleção
              </button>
            </div>
          </div>

          {labelMode === 'LUGGAGE' && labelLoading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" aria-hidden="true" />
              Carregando volumes...
            </div>
          ) : (
            <div className="qr-label-selection-list">
              {labelMode === 'PASSENGER'
                ? filteredPassengers.map((passenger) => (
                    <label className="qr-label-selection-item" key={`label-passenger-${passenger.id}`}>
                      <input
                        type="checkbox"
                        checked={selectedLabelIds.has(passenger.id)}
                        onChange={() => toggleLabelSelection(passenger.id)}
                      />
                      <span>
                        <strong>{passenger.fullName}</strong>
                        <small>{passenger.city} • {TRAVEL_PERIOD_LABELS[passenger.travelPeriod]} • {BUS_TYPE_LABELS[passenger.busType]}</small>
                      </span>
                    </label>
                  ))
                : visibleLabelLuggage.map((item) => (
                    <label className="qr-label-selection-item" key={`label-luggage-${item.luggage.id}`}>
                      <input
                        type="checkbox"
                        checked={selectedLabelIds.has(item.luggage.id)}
                        onChange={() => toggleLabelSelection(item.luggage.id)}
                      />
                      <span>
                        <strong>{item.passenger.fullName} • {item.luggage.code}</strong>
                        <small>{item.luggage.luggageType} • {luggagePositions.get(item.luggage.id)} • {item.passenger.city}</small>
                      </span>
                    </label>
                  ))}
            </div>
          )}

          <div className="qr-label-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={selectedVisibleCount !== 1}
              onClick={() => void downloadSelectedQr()}
              title={selectedVisibleCount === 1 ? 'Baixar o QR selecionado em SVG' : 'Selecione somente um item para baixar o QR'}
            >
              <Download aria-hidden="true" />
              Baixar QR
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={selectedVisibleCount === 0}
              onClick={() => printQrLabels(buildBulkLabelItems(true), labelMode === 'PASSENGER' ? 'Passageiros_Selecionados' : 'Volumes_Selecionados')}
            >
              <Printer aria-hidden="true" />
              Imprimir selecionados ({selectedVisibleCount})
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={currentLabelIds.length === 0}
              onClick={() => printQrLabels(buildBulkLabelItems(false), labelMode === 'PASSENGER' ? 'Passageiros_Todos' : 'Volumes_Todos')}
            >
              <Printer aria-hidden="true" />
              Imprimir todos ({currentLabelIds.length})
            </button>
          </div>
        </div>
      </Modal>

      <section className="qr-label-print-sheet" aria-hidden="true">
        {labelPages.map((pageItems, pageIndex) => (
          <div className="qr-label-print-page" key={`qr-label-page-${pageIndex}`}>
            {pageItems.map((item) => (
              <article className="qr-label-print-card" key={item.id}>
                <div className="qr-label-print-card__content">
                  <small>CARAVANA FLÁVIO GONÇALVES • BARRETÃO 2026</small>
                  <strong className="qr-label-print-card__name">{item.passengerName}</strong>
                  <span>{item.city}</span>
                  <span>{TRAVEL_PERIOD_LABELS[item.travelPeriod]} • {BUS_TYPE_LABELS[item.busType]}</span>
                  {item.kind === 'LUGGAGE' ? (
                    <>
                      <strong className="qr-label-print-card__code">{item.luggageCode}</strong>
                      <span>{item.volumePosition} • {item.luggageType}</span>
                      <em>ETIQUETA RESERVA • usar quando o lacre não puder ser fixado</em>
                    </>
                  ) : (
                    <em>IDENTIFICAÇÃO DO PASSAGEIRO</em>
                  )}
                </div>
                <div className="qr-label-print-card__qr">
                  <img src={createQrSvgDataUrl(item.qrValue)} alt="QR Code" />
                  <small>{item.kind === 'LUGGAGE' ? 'VOLUME' : 'PASSAGEIRO'}</small>
                </div>
              </article>
            ))}
          </div>
        ))}
      </section>

      <section className="passenger-print-report" aria-hidden="true">
        <header className="passenger-print-report__header">
          <div>
            <p>Caravana Flávio Gonçalves • Controle de passageiros</p>
            <h1>Lista de passageiros • Barretão 2026</h1>
            <span>
              {cityFilter || 'Todas as cidades'} • {periodFilter ? TRAVEL_PERIOD_LABELS[periodFilter] : 'Todos os períodos'}
              {reviewOnly ? ' • Somente cadastros para revisar' : ''}
              {query.trim() ? ` • Pesquisa: ${query.trim()}` : ''}
            </span>
          </div>
          <div>
            <strong>{filteredPassengers.length}</strong>
            <span>{filteredPassengers.length === 1 ? 'passageiro exibido' : 'passageiros exibidos'}</span>
            <small>Emitida em {new Date().toLocaleString('pt-BR')}</small>
          </div>
        </header>

        <div className="passenger-print-summary">
          <div>
            <span>1ª semana</span>
            <strong>{printSummary.firstWeek}</strong>
          </div>
          <div>
            <span>2ª semana</span>
            <strong>{printSummary.secondWeek}</strong>
          </div>
          <div>
            <span>Duas semanas</span>
            <strong>{printSummary.bothWeeks}</strong>
          </div>
          <div>
            <span>Para revisar</span>
            <strong>{printSummary.review}</strong>
          </div>
          <div>
            <span>Total exibido</span>
            <strong>{filteredPassengers.length}</strong>
          </div>
        </div>

        {printGroups.map((periodGroup, periodIndex) => (
          <section
            className={`passenger-print-week ${periodIndex > 0 ? 'print-page-break-before' : ''}`}
            key={`print-period-${periodGroup.travelPeriod}`}
          >
            <header className="passenger-print-week__header">
              <div>
                <span>Período</span>
                <h2>{TRAVEL_PERIOD_LABELS[periodGroup.travelPeriod]}</h2>
              </div>
              <strong>{periodGroup.count} {periodGroup.count === 1 ? 'passageiro' : 'passageiros'}</strong>
            </header>

            {periodGroup.buses.map((busGroup) => (
              <section className="passenger-print-bus" key={`print-bus-${periodGroup.travelPeriod}-${busGroup.busType}`}>
                <header className="passenger-print-bus__header">
                  <h3>{BUS_TYPE_LABELS[busGroup.busType]}</h3>
                  <strong>{busGroup.count} {busGroup.count === 1 ? 'passageiro' : 'passageiros'}</strong>
                </header>

                {busGroup.cities.map((cityGroup) => (
                  <section
                    className="passenger-print-city"
                    key={`print-city-${periodGroup.travelPeriod}-${busGroup.busType}-${cityGroup.city}`}
                  >
                    <header className="passenger-print-city__header">
                      <h4>{cityGroup.city}</h4>
                      <span>{cityGroup.passengers.length} {cityGroup.passengers.length === 1 ? 'passageiro' : 'passageiros'}</span>
                    </header>

                    <table className="passenger-print-table">
                      <thead>
                        <tr>
                          <th>Nº</th>
                          <th>Nome</th>
                          <th>Documento</th>
                          <th>Telefone</th>
                          <th>Cadastro</th>
                          <th>Observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cityGroup.passengers.map((passenger, index) => (
                          <tr key={`print-${passenger.id}`}>
                            <td>{index + 1}</td>
                            <td>{passenger.fullName}</td>
                            <td>
                              {passenger.documentNumber
                                ? `${DOCUMENT_TYPE_LABELS[passenger.documentType]}: ${passenger.documentNumber}`
                                : 'Não informado'}
                            </td>
                            <td>{passenger.phone || 'Não informado'}</td>
                            <td className={passenger.reviewStatus === 'REVIEW' ? 'passenger-print-review' : undefined}>
                              {passenger.reviewStatus === 'REVIEW' ? '⚠ REVISAR' : 'Confirmado'}
                            </td>
                            <td>
                              {[passenger.notes, passenger.importWarning ? `Alerta: ${passenger.importWarning}` : '']
                                .filter(Boolean)
                                .join(' | ') || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
              </section>
            ))}
          </section>
        ))}
      </section>

      <Modal
        open={Boolean(updatePreview)}
        title="Revisar atualização da lista"
        subtitle="O arquivo é comparado com a base atual antes de qualquer gravação."
        onClose={() => {
          if (applyingUpdate) return
          setUpdatePreview(null)
          setUpdateError('')
        }}
        size="large"
      >
        {updatePreview ? (
          <div className="passenger-update-preview">
            {updatePreview.alreadyImportedAt ? (
              <div className="alert alert--danger">
                <AlertTriangle aria-hidden="true" />
                <div>
                  <strong>Estes arquivos já foram aplicados</strong>
                  <p>Importação registrada em {formatDateTime(updatePreview.alreadyImportedAt)}. Nenhum dado será duplicado.</p>
                </div>
              </div>
            ) : null}

            <div className="passenger-update-summary">
              <button type="button" className={updateFilter === 'NEW' ? 'is-active tone-green' : 'tone-green'} onClick={() => setUpdateFilter('NEW')}>
                <span>Novos</span><strong>{updatePreview.newCount}</strong>
              </button>
              <button type="button" className={updateFilter === 'CHANGED' ? 'is-active tone-blue' : 'tone-blue'} onClick={() => setUpdateFilter('CHANGED')}>
                <span>Alterados</span><strong>{updatePreview.changedCount}</strong>
              </button>
              <button type="button" className={updateFilter === 'UNCHANGED' ? 'is-active' : undefined} onClick={() => setUpdateFilter('UNCHANGED')}>
                <span>Sem mudança</span><strong>{updatePreview.unchangedCount}</strong>
              </button>
              <button type="button" className={updateFilter === 'CONFLICT' ? 'is-active tone-amber' : 'tone-amber'} onClick={() => setUpdateFilter('CONFLICT')}>
                <span>Conflitos</span><strong>{updatePreview.conflictCount}</strong>
              </button>
            </div>

            <div className="passenger-update-toolbar">
              <div>
                <strong>{updatePreview.totalRows} linhas interpretadas</strong>
                <span>{updatePreview.fileNames.join(' • ')}</span>
              </div>
              <button type="button" className="secondary-button" onClick={() => setUpdateFilter('ALL')}>
                Ver todos ({updatePreview.totalRows})
              </button>
            </div>

            <div className="passenger-update-list">
              {visibleUpdateItems.map((item) => (
                <article className={`passenger-update-item status-${item.status.toLowerCase()}`} key={item.id}>
                  <div className="passenger-update-item__heading">
                    <div>
                      <span className={`passenger-update-status status-${item.status.toLowerCase()}`}>{UPDATE_STATUS_LABELS[item.status]}</span>
                      <h3>{item.row.fullName}</h3>
                      <p>
                        {item.row.documentNumber || 'Documento não informado'} • {item.row.city || 'Cidade não identificada'} • {item.row.travelPeriod ? TRAVEL_PERIOD_LABELS[item.row.travelPeriod] : 'Período não identificado'} • {BUS_TYPE_LABELS[item.row.busType]}
                      </p>
                    </div>
                    <small>{item.row.sourceFile}{item.row.sourcePage ? ` • pág. ${item.row.sourcePage}` : ''}</small>
                  </div>

                  {item.changes.length > 0 ? (
                    <div className="passenger-update-changes">
                      {item.changes.map((change) => (
                        <div key={`${item.id}-${change.field}`}>
                          <strong>{change.label}</strong>
                          <span>{change.previousValue}</span>
                          <b>→</b>
                          <em>{change.nextValue}</em>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {item.status === 'CONFLICT' ? (
                    <div className="passenger-update-message is-warning">
                      <AlertTriangle aria-hidden="true" />
                      <span>{item.message} {item.candidatePassengerIds.length > 0 ? 'Os cadastros possíveis serão enviados para “Revisar cadastros”.' : 'Esta linha não será gravada automaticamente.'}</span>
                    </div>
                  ) : null}

                  {item.row.parseWarning ? (
                    <div className="passenger-update-message is-warning">
                      <AlertTriangle aria-hidden="true" />
                      <span>{item.row.parseWarning}</span>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            {updateError ? <div className="alert alert--danger">{updateError}</div> : null}

            <div className="passenger-update-rules">
              <CheckCircle2 aria-hidden="true" />
              <p><strong>Proteção da atualização:</strong> novos registros são incluídos, alterações exibidas acima são aplicadas, passageiros ausentes no novo arquivo não são excluídos e conflitos nunca substituem dados automaticamente.</p>
            </div>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setUpdatePreview(null)} disabled={applyingUpdate}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void handleApplyUpdate()} disabled={applyingUpdate || Boolean(updatePreview.alreadyImportedAt)}>
                {applyingUpdate ? <LoaderCircle className="spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                Confirmar atualização
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={importHistoryOpen}
        title="Histórico das listas importadas"
        subtitle="Registro das atualizações aplicadas neste aparelho."
        onClose={() => setImportHistoryOpen(false)}
        size="large"
      >
        <div className="passenger-import-history">
          {importStatus?.completed ? (
            <article className="passenger-import-history-item is-initial">
              <div><Database aria-hidden="true" /></div>
              <section>
                <strong>Lista inicial provisória 2026</strong>
                <span>{importStatus.sourceTotal} registros • {importStatus.sourceReviewTotal} sinalizados inicialmente para revisão</span>
                <time>{importStatus.completedAt ? formatDateTime(importStatus.completedAt) : ''}</time>
              </section>
            </article>
          ) : null}

          {importBatches.length === 0 ? (
            <div className="mini-empty-state">
              <FileClock aria-hidden="true" />
              <p>Nenhuma atualização em PDF ou Excel foi aplicada depois da lista inicial.</p>
            </div>
          ) : (
            importBatches.map((batch, index) => (
              <article className="passenger-import-history-item" key={batch.id}>
                <div><RefreshCcw aria-hidden="true" /></div>
                <section>
                  <strong>Atualização {importBatches.length - index}</strong>
                  <span>{batch.fileNames.join(' • ')}</span>
                  <p>
                    +{batch.newCount} novos • {batch.updatedCount} alterados • {batch.unchangedCount} sem mudança • {batch.conflictCount} conflitos
                  </p>
                  {batch.conflictNotes.length > 0 ? (
                    <details className="passenger-import-history-conflicts">
                      <summary>Ver conflitos registrados</summary>
                      {batch.conflictNotes.map((note) => <span key={note}>{note}</span>)}
                    </details>
                  ) : null}
                  <time>{formatDateTime(batch.importedAt)}</time>
                </section>
              </article>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={passengerModalOpen}
        title={editingPassenger ? 'Editar passageiro' : 'Novo passageiro'}
        subtitle="Somente as informações necessárias para localizar o dono das bagagens."
        onClose={() => setPassengerModalOpen(false)}
      >
        <form className="form-stack" onSubmit={handlePassengerSubmit}>
          <label className="field">
            <span>Nome completo *</span>
            <input
              value={passengerForm.fullName}
              onChange={(event) => setPassengerForm((current) => ({ ...current, fullName: event.target.value }))}
              autoFocus
              autoComplete="name"
            />
          </label>

          <div className="form-grid">
            <label className="field">
              <span>Cidade de embarque *</span>
              <select
                value={passengerForm.city}
                onChange={(event) => setPassengerForm((current) => ({ ...current, city: event.target.value }))}
              >
                <option value="">Selecione</option>
                {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
              </select>
            </label>

            <label className="field">
              <span>Telefone</span>
              <input
                value={passengerForm.phone}
                onChange={(event) => setPassengerForm((current) => ({ ...current, phone: event.target.value }))}
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Tipo de documento</span>
              <select
                value={passengerForm.documentType}
                onChange={(event) => setPassengerForm((current) => ({
                  ...current,
                  documentType: event.target.value as PassengerInput['documentType'],
                }))}
              >
                <option value="CPF">CPF</option>
                <option value="RG">RG</option>
                <option value="UNKNOWN">Não identificado</option>
              </select>
            </label>

            <label className="field">
              <span>Documento</span>
              <input
                value={passengerForm.documentNumber}
                onChange={(event) => setPassengerForm((current) => ({ ...current, documentNumber: event.target.value }))}
                placeholder="CPF, RG ou número informado pela equipe"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Ônibus</span>
              <select
                value={passengerForm.busType}
                onChange={(event) => setPassengerForm((current) => ({
                  ...current,
                  busType: event.target.value as PassengerInput['busType'],
                }))}
              >
                <option value="UNSPECIFIED">Não informado</option>
                <option value="DOUBLE_DECKER">Ônibus 2 andares</option>
                <option value="CONVENTIONAL">Ônibus convencional</option>
              </select>
            </label>

            <label className="field">
              <span>Situação do cadastro</span>
              <select
                value={passengerForm.reviewStatus}
                onChange={(event) => setPassengerForm((current) => ({
                  ...current,
                  reviewStatus: event.target.value as PassengerInput['reviewStatus'],
                }))}
              >
                <option value="CONFIRMED">Confirmado</option>
                <option value="REVIEW">Precisa revisar</option>
              </select>
            </label>

            {editingPassenger?.reviewStatus === 'REVIEW' && passengerForm.reviewStatus === 'CONFIRMED' ? (
              <div className="passenger-review-resolution-note">
                <CheckCircle2 aria-hidden="true" />
                <span>Ao salvar, este passageiro será marcado como revisado e sairá da lista de cadastros para conferir.</span>
              </div>
            ) : null}
          </div>

          {editingPassenger?.importWarning ? (
            <div className={`passenger-review-origin ${passengerForm.reviewStatus === 'REVIEW' ? 'is-open' : 'is-resolved'}`}>
              {passengerForm.reviewStatus === 'REVIEW' ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
              <div>
                <strong>Alerta preservado da lista original</strong>
                <p>{editingPassenger.importWarning}</p>
                <small>Ao marcar o cadastro como confirmado, este alerta permanece guardado como histórico da importação.</small>
              </div>
            </div>
          ) : null}

          <fieldset className="period-fieldset">
            <legend>Período *</legend>
            <div className="period-options">
              {TRAVEL_PERIOD_OPTIONS.map((option) => (
                <label key={option.value} className={passengerForm.travelPeriod === option.value ? 'is-selected' : undefined}>
                  <input
                    type="radio"
                    name="travelPeriod"
                    value={option.value}
                    checked={passengerForm.travelPeriod === option.value}
                    onChange={() => setPassengerForm((current) => ({ ...current, travelPeriod: option.value }))}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Observação</span>
            <textarea
              rows={3}
              value={passengerForm.notes}
              onChange={(event) => setPassengerForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Somente algo útil para identificar ou organizar as bagagens."
            />
          </label>

          {passengerFormError ? <div className="alert alert--danger">{passengerFormError}</div> : null}

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => setPassengerModalOpen(false)}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={savingPassenger}>
              {savingPassenger ? <LoaderCircle className="spin" /> : null}
              Salvar passageiro
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Excluir passageiro definitivamente?"
        subtitle="Esta ação não cria lixeira e não poderá ser desfeita."
        onClose={() => setDeleteTarget(null)}
      >
        {deleteTarget ? (
          <div className="delete-confirmation">
            <div className="alert alert--danger">
              <Trash2 aria-hidden="true" />
              <div>
                <strong>{deleteTarget.fullName}</strong>
                <p>
                  Serão excluídas também {deleteTarget.luggageCount} {deleteTarget.luggageCount === 1 ? 'bagagem vinculada' : 'bagagens vinculadas'}, fotografias e todo o histórico correspondente.
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>Voltar</button>
              <button type="button" className="danger-button" onClick={() => void handleDeletePassenger()} disabled={deletingPassenger}>
                {deletingPassenger ? <LoaderCircle className="spin" /> : <Trash2 />}
                Excluir para sempre
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(luggagePassenger)}
        title={luggagePassenger ? `Bagagens de ${luggagePassenger.fullName}` : 'Bagagens'}
        subtitle={luggagePassenger ? `${luggagePassenger.city} • ${TRAVEL_PERIOD_LABELS[luggagePassenger.travelPeriod]}` : undefined}
        onClose={closeLuggageModal}
        size="large"
      >
        <div className="luggage-workspace">
          <section className={`set-photo-card ${setPhoto ? 'has-photo' : 'is-pending'}`}>
            <div className="set-photo-card__content">
              <div className="form-section-title">
                <Camera aria-hidden="true" />
                <div>
                  <strong>Foto do conjunto de bagagens</strong>
                  <span>
                    {setPhoto
                      ? `Salva em ${formatDateTime(setPhoto.createdAt)} • ${formatFileSize(setPhoto.sizeBytes)}`
                      : 'Obrigatória antes de encerrar o recebimento deste passageiro.'}
                  </span>
                </div>
              </div>

              {setPhoto ? (
                <div className="photo-status photo-status--ok">Foto vinculada a todos os volumes deste passageiro.</div>
              ) : (
                <div className="photo-status photo-status--pending">Foto do conjunto ainda pendente.</div>
              )}

              <div className="set-photo-actions">
                <PhotoCaptureButtons
                  onSelect={handleSetPhoto}
                  busy={photoBusyKey === 'set'}
                  cameraLabel={setPhoto ? 'Refazer foto' : 'Tirar foto'}
                  galleryLabel={setPhoto ? 'Substituir da galeria' : 'Escolher da galeria'}
                />
                {setPhoto ? (
                  <button type="button" className="danger-outline-button" onClick={() => void removeSetPhoto()}>
                    <Trash2 aria-hidden="true" />
                    Remover
                  </button>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              className="set-photo-preview"
              onClick={() => setPhotoUrl && setPhotoViewer({ title: 'Foto do conjunto', url: setPhotoUrl })}
              disabled={!setPhotoUrl}
              aria-label="Visualizar foto do conjunto"
            >
              {setPhotoUrl ? <img src={setPhotoUrl} alt="Conjunto de bagagens do passageiro" /> : <ImageOff aria-hidden="true" />}
              {setPhotoUrl ? <span><Eye aria-hidden="true" /> Ampliar</span> : null}
            </button>
          </section>

          {photoError ? <div className="alert alert--danger">{photoError}</div> : null}

          <div className="luggage-layout">
            <form className="luggage-form form-stack" onSubmit={handleLuggageSubmit}>
              <div className="form-section-title">
                <PackagePlus aria-hidden="true" />
                <div>
                  <strong>{luggageEntryMode === 'QUICK_SET' ? 'Cadastrar conjunto de bagagens' : 'Incluir uma bagagem'}</strong>
                  <span>
                    {luggageEntryMode === 'QUICK_SET'
                      ? 'Informe somente a quantidade. O app cria os volumes internos sem exigir números de lacre.'
                      : 'Use este modo quando existir um código, QR ou lacre físico real.'}
                  </span>
                </div>
              </div>

              <div className="code-mode-switch" role="group" aria-label="Modo de cadastro de bagagem">
                <button
                  type="button"
                  className={luggageEntryMode === 'QUICK_SET' ? 'is-active' : undefined}
                  onClick={() => {
                    setLuggageEntryMode('QUICK_SET')
                    setLuggageFormError('')
                  }}
                >
                  <PackagePlus aria-hidden="true" />
                  Rápido por conjunto
                </button>
                <button
                  type="button"
                  className={luggageEntryMode === 'INDIVIDUAL' ? 'is-active' : undefined}
                  onClick={() => {
                    setLuggageEntryMode('INDIVIDUAL')
                    setLuggageFormError('')
                  }}
                >
                  <Barcode aria-hidden="true" />
                  Código / lacre
                </button>
              </div>

              {luggageEntryMode === 'QUICK_SET' ? (
                <>
                  <div className={setPhoto ? 'photo-status photo-status--ok' : 'photo-status photo-status--pending'}>
                    {setPhoto
                      ? 'Foto do conjunto pronta. Ela será a referência visual desses volumes.'
                      : 'Recomendado: tire a foto do conjunto acima antes de salvar os volumes.'}
                  </div>

                  <label className="field">
                    <span>Quantidade de volumes *</span>
                    <div className="code-input-row">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setQuickVolumeCount((current) => Math.max(1, current - 1))}
                        disabled={savingLuggage || quickVolumeCount <= 1}
                        aria-label="Diminuir quantidade de volumes"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        inputMode="numeric"
                        value={quickVolumeCount}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          setQuickVolumeCount(Number.isFinite(value) ? Math.max(1, Math.min(99, Math.trunc(value))) : 1)
                        }}
                        aria-label="Quantidade de volumes"
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setQuickVolumeCount((current) => Math.min(99, current + 1))}
                        disabled={savingLuggage || quickVolumeCount >= 99}
                        aria-label="Aumentar quantidade de volumes"
                      >
                        +
                      </button>
                    </div>
                  </label>

                  <label className="field">
                    <span>Observação do conjunto</span>
                    <textarea
                      rows={2}
                      value={luggageForm.notes}
                      onChange={(event) => setLuggageForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Ex.: 2 sacos pretos, 1 caixa e 1 mala azul"
                    />
                  </label>

                  <div className="photo-status photo-status--ok">
                    Você não precisa inventar códigos como 9999. Cada volume receberá um identificador interno automático e continuará contando normalmente nas etapas e relatórios.
                  </div>
                </>
              ) : (
                <>
                  <div className="code-mode-switch" role="group" aria-label="Forma de inserir o código">
                    <button
                      type="button"
                      className={luggageForm.codeSource === 'MANUAL' ? 'is-active' : undefined}
                      onClick={() => updateCodeSource('MANUAL')}
                    >
                      <Barcode aria-hidden="true" />
                      Digitar código
                    </button>
                    <button
                      type="button"
                      className={luggageForm.codeSource === 'SCANNER' ? 'is-active' : undefined}
                      onClick={() => updateCodeSource('SCANNER')}
                    >
                      <Camera aria-hidden="true" />
                      Escanear
                    </button>
                  </div>

                  <label className="field">
                    <span>Código do lacre *</span>
                    <div className="code-input-row">
                      <input
                        value={luggageForm.code}
                        onChange={(event) => setLuggageForm((current) => ({ ...current, code: event.target.value, codeSource: 'MANUAL' }))}
                        placeholder="Ex.: 0005301"
                        autoComplete="off"
                      />
                      <button type="button" className="scan-button" onClick={() => setScannerOpen(true)} aria-label="Abrir câmera para escanear">
                        <Camera aria-hidden="true" />
                      </button>
                    </div>
                  </label>

                  <div className="form-grid">
                    <label className="field">
                      <span>Cor da etiqueta ou lacre *</span>
                      <input
                        list="label-colors"
                        value={luggageForm.labelColor}
                        onChange={(event) => setLuggageForm((current) => ({ ...current, labelColor: event.target.value }))}
                        placeholder="Ex.: Verde"
                      />
                      <datalist id="label-colors">
                        {LABEL_COLORS.map((color) => <option key={color} value={color} />)}
                      </datalist>
                    </label>

                    <label className="field">
                      <span>Tipo</span>
                      <select
                        value={luggageForm.luggageType}
                        onChange={(event) => setLuggageForm((current) => ({ ...current, luggageType: event.target.value }))}
                      >
                        <option>Mala</option>
                        <option>Bolsa</option>
                        <option>Mochila</option>
                        <option>Caixa</option>
                        <option>Sacola</option>
                        <option>Outro</option>
                      </select>
                    </label>
                  </div>

                  <label className="field">
                    <span>Observação da bagagem</span>
                    <textarea
                      rows={2}
                      value={luggageForm.notes}
                      onChange={(event) => setLuggageForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Ex.: mala preta grande com fita vermelha"
                    />
                  </label>
                </>
              )}

              {luggageFormError ? <div className="alert alert--danger">{luggageFormError}</div> : null}

              <button type="submit" className="primary-button" disabled={savingLuggage}>
                {savingLuggage ? <LoaderCircle className="spin" /> : <PackagePlus />}
                {savingLuggage
                  ? 'Salvando...'
                  : luggageEntryMode === 'QUICK_SET'
                    ? `Salvar ${quickVolumeCount} ${quickVolumeCount === 1 ? 'volume' : 'volumes'}`
                    : 'Cadastrar bagagem'}
              </button>
            </form>

            <section className="luggage-list-panel">
              <div className="form-section-title">
                <BriefcaseBusiness aria-hidden="true" />
                <div>
                  <strong>Volumes já cadastrados</strong>
                  <span>{luggage.length} {luggage.length === 1 ? 'volume' : 'volumes'}</span>
                </div>
              </div>

              {luggage.length === 0 ? (
                <div className="mini-empty-state">
                  <BriefcaseBusiness aria-hidden="true" />
                  <p>Nenhuma bagagem cadastrada para este passageiro.</p>
                </div>
              ) : (
                <div className="luggage-list">
                  {luggage.map((item, index) => {
                    const individualPhoto = luggagePhotos[item.id]
                    const individualPhotoUrl = luggagePhotoUrls[item.id]
                    return (
                      <article className="luggage-item luggage-item--with-photo" key={item.id}>
                        <button
                          type="button"
                          className="luggage-photo-thumb"
                          onClick={() => individualPhotoUrl && setPhotoViewer({ title: `Bagagem ${luggageDisplayCode(item.code)}`, url: individualPhotoUrl })}
                          disabled={!individualPhotoUrl}
                          aria-label={`Visualizar foto da bagagem ${luggageDisplayCode(item.code)}`}
                        >
                          {individualPhotoUrl ? <img src={individualPhotoUrl} alt={`Bagagem ${luggageDisplayCode(item.code)}`} /> : <Camera aria-hidden="true" />}
                        </button>

                        <div className="luggage-number">{index + 1}</div>
                        <div className="luggage-item__content">
                          <strong>{luggageDisplayCode(item.code)}</strong>
                          <span>{isAutomaticLuggageCode(item.code) ? 'Cadastro rápido por conjunto' : `${item.luggageType} • ${item.labelColor}`}</span>
                          <small>Cadastrada em {formatDateTime(item.createdAt)}</small>
                          <span className={`luggage-current-stage stage-${item.currentStage.toLowerCase()}`}>
                            {STAGE_LABELS[item.currentStage]}
                          </span>
                          <em>{individualPhoto ? 'Foto individual vinculada' : 'Foto individual opcional'}</em>
                        </div>

                        <div className="luggage-item__actions">
                          <PhotoCaptureButtons
                            compact
                            busy={photoBusyKey === item.id}
                            onSelect={(file) => handleLuggagePhoto(item, file)}
                            cameraLabel={individualPhoto ? 'Refazer' : 'Foto'}
                            galleryLabel="Galeria"
                          />
                          {individualPhoto ? (
                            <button type="button" className="mini-action-button mini-action-button--danger" onClick={() => void removeLuggagePhoto(item)} title="Remover foto individual">
                              <Trash2 aria-hidden="true" />
                              <span>Remover foto</span>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="mini-action-button"
                            onClick={() => luggagePassenger && printSingleLuggageLabel(item, luggagePassenger, luggage)}
                            title="Imprimir etiqueta reserva deste volume"
                          >
                            <Printer aria-hidden="true" />
                            <span>Etiqueta reserva</span>
                          </button>
                          <button type="button" className="mini-action-button" onClick={() => void openHistory(item)} title="Abrir histórico">
                            <History aria-hidden="true" />
                            <span>Histórico</span>
                          </button>
                          <button type="button" className="mini-action-button mini-action-button--danger" onClick={() => void handleDeleteLuggage(item)} title="Excluir bagagem">
                            <Trash2 aria-hidden="true" />
                            <span>Excluir</span>
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(historyTarget)}
        title={historyTarget ? `Histórico da bagagem ${luggageDisplayCode(historyTarget.code)}` : 'Histórico da bagagem'}
        subtitle="Linha do tempo completa deste volume."
        onClose={() => {
          setHistoryTarget(null)
          setHistoryMovements([])
          setHistoryPhotos([])
        }}
        size="large"
      >
        {historyLoading ? (
          <div className="loading-state"><LoaderCircle className="spin" /> Carregando histórico...</div>
        ) : (
          <div className="history-timeline">
            {historyMovements.map((movement) => {
              const photos = historyPhotos.filter((photo) => (movement.photoIds ?? []).includes(photo.id))
              return (
                <article className="history-entry" key={movement.id}>
                  <div className="history-entry__marker"><Clock3 aria-hidden="true" /></div>
                  <div className="history-entry__body">
                    <div className="history-entry__heading">
                      <strong>{MOVEMENT_LABELS[movement.type]}</strong>
                      <time>{formatDateTime(movement.occurredAt)}</time>
                    </div>
                    <p>{movement.note}</p>
                    {photos.length > 0 ? (
                      <div className="history-photo-grid">
                        {photos.map((photo) => (
                          <button
                            type="button"
                            key={photo.id}
                            onClick={() => setPhotoViewer({
                              title: photo.kind === 'PASSENGER_SET' ? 'Foto do conjunto' : 'Foto individual da bagagem',
                              url: historyPhotoUrls[photo.id],
                            })}
                          >
                            <img src={historyPhotoUrls[photo.id]} alt="Fotografia vinculada à movimentação" />
                            <span>{photo.kind === 'PASSENGER_SET' ? 'Conjunto' : 'Individual'}</span>
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

      <Modal
        open={Boolean(photoViewer)}
        title={photoViewer?.title ?? 'Fotografia'}
        onClose={() => setPhotoViewer(null)}
        size="large"
      >
        {photoViewer ? (
          <div className="photo-viewer">
            <img src={photoViewer.url} alt={photoViewer.title} />
          </div>
        ) : null}
      </Modal>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false)
          setLuggageForm((current) => ({ ...current, codeSource: current.code ? current.codeSource : 'MANUAL' }))
        }}
        onDetected={handleScannedCode}
      />
    </div>
  )
}
