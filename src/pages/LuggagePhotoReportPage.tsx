import {
  BriefcaseBusiness,
  Camera,
  ChevronDown,
  ImageOff,
  LoaderCircle,
  MapPin,
  Printer,
  RefreshCcw,
  Search,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import {
  getPassengerSetPhoto,
  getPhotosByIds,
  listLuggageByPassenger,
  listLuggageMovements,
  listPassengers,
  listSetReconciliationsByPassenger,
} from '../data/repository'
import type {
  Luggage,
  LuggageMovement,
  LuggageStage,
  PassengerSummary,
  PhotoRecord,
  SetReconciliation,
  TravelPeriod,
} from '../domain/types'
import { isNativeAndroidPrint, printCurrentDocument } from '../utils/nativePrint'

interface PhotoReportRecord {
  passenger: PassengerSummary
  luggage: Luggage[]
  movements: LuggageMovement[]
  reconciliations: SetReconciliation[]
  reconciliationPhotos: PhotoRecord[]
  photo?: PhotoRecord
}

const MOVEMENT_LABELS: Record<LuggageMovement['type'], string> = {
  REGISTERED_AT_WAREHOUSE: 'Recebida no galpão',
  WAREHOUSE_TO_TRAILER: 'Galpão → carreta',
  TRAILER_TO_PASSENGER: 'Carreta → passageiro',
  PASSENGER_TO_TRAILER: 'Passageiro → carreta',
  TRAILER_TO_WAREHOUSE: 'Carreta → galpão',
  WAREHOUSE_TO_CITY: 'Galpão → cidade',
}

const MOVEMENT_ORDER: LuggageMovement['type'][] = [
  'REGISTERED_AT_WAREHOUSE',
  'WAREHOUSE_TO_TRAILER',
  'TRAILER_TO_PASSENGER',
  'PASSENGER_TO_TRAILER',
  'TRAILER_TO_WAREHOUSE',
  'WAREHOUSE_TO_CITY',
]

const SET_RECONCILIATION_LABELS: Record<SetReconciliation['result'], string> = {
  NO_RELEVANT_CHANGE: 'Sem alteração relevante',
  REORGANIZED: 'Reorganizado / volumes agrupados',
  SPLIT_INCREASED: 'Volumes separados / aumentou a quantidade',
  POSSIBLE_MISSING: 'Possível volume faltante',
  ADDITIONAL_VOLUME: 'Volume adicional',
  OTHER: 'Outro',
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleUpperCase('pt-BR')
}

function fileNamePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function reportTimestamp() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function luggageNotes(record: PhotoReportRecord) {
  return Array.from(
    new Set(record.luggage.map((item) => item.notes.trim()).filter(Boolean)),
  ).join(' • ')
}

function stageSummary(passenger: PassengerSummary) {
  return (Object.entries(passenger.luggageStageCounts) as Array<[LuggageStage, number]>)
    .filter(([, count]) => count > 0)
    .map(([stage, count]) => `${count} ${STAGE_LABELS[stage]}`)
    .join(' • ')
}

function movementTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function movementGroups(record: PhotoReportRecord) {
  return MOVEMENT_ORDER.map((type) => {
    const items = record.movements
      .filter((movement) => movement.type === type)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

    if (items.length === 0) return null

    const first = items[0].occurredAt
    const last = items[items.length - 1].occurredAt
    const timeLabel =
      first === last
        ? movementTime(first)
        : `${movementTime(first)} até ${movementTime(last)}`

    return {
      type,
      label: MOVEMENT_LABELS[type],
      count: items.length,
      timeLabel,
      lastAt: last,
    }
  }).filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function latestMovement(record: PhotoReportRecord) {
  return [...record.movements]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
}

function latestReconciliation(record: PhotoReportRecord) {
  return [...record.reconciliations]
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0]
}

async function waitForReportImages() {
  const images = Array.from(
    document.querySelectorAll<HTMLImageElement>('.photo-report-print-root img'),
  )

  await Promise.all(
    images.map((image) => {
      if (image.complete) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const finish = () => resolve()
        image.addEventListener('load', finish, { once: true })
        image.addEventListener('error', finish, { once: true })
        window.setTimeout(finish, 1500)
      })
    }),
  )
}

export function LuggagePhotoReportPage() {
  const [records, setRecords] = useState<PhotoReportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [query, setQuery] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState<TravelPeriod | ''>('')
  const [onlyWithPhoto, setOnlyWithPhoto] = useState(true)
  const [printing, setPrinting] = useState(false)

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage('')

      const passengers = (await listPassengers()).filter(
        (passenger) => passenger.luggageCount > 0,
      )

      const loaded = await Promise.all(
        passengers.map(async (passenger) => {
          const [luggage, photo, reconciliations] = await Promise.all([
            listLuggageByPassenger(passenger.id),
            getPassengerSetPhoto(passenger.id),
            listSetReconciliationsByPassenger(passenger.id),
          ])
          const [movementLists, reconciliationPhotos] = await Promise.all([
            Promise.all(luggage.map((item) => listLuggageMovements(item.id))),
            getPhotosByIds(reconciliations.map((item) => item.photoId)),
          ])
          return {
            passenger,
            luggage,
            movements: movementLists.flat(),
            reconciliations,
            reconciliationPhotos,
            photo,
          }
        }),
      )

      loaded.sort((a, b) => {
        const city = a.passenger.city.localeCompare(b.passenger.city, 'pt-BR')
        return city || a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR')
      })

      setRecords(loaded)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível montar o relatório fotográfico.',
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

  const photoUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    for (const record of records) {
      if (record.photo) {
        urls[record.photo.id] = URL.createObjectURL(record.photo.blob)
      }
      for (const reconciliationPhoto of record.reconciliationPhotos) {
        if (urls[reconciliationPhoto.id]) continue
        urls[reconciliationPhoto.id] = URL.createObjectURL(reconciliationPhoto.blob)
      }
    }
    return urls
  }, [records])

  useEffect(() => {
    return () => {
      Object.values(photoUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [photoUrls])

  const cities = useMemo(
    () => Array.from(new Set(records.map((record) => record.passenger.city)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [records],
  )

  const filteredRecords = useMemo(() => {
    const normalizedQuery = normalizeSearch(query)

    return records.filter((record) => {
      const matchesQuery =
        !normalizedQuery ||
        record.passenger.normalizedName.includes(normalizedQuery)
      const matchesCity = !cityFilter || record.passenger.city === cityFilter
      const matchesPeriod = !periodFilter || record.passenger.travelPeriod === periodFilter
      const matchesPhoto = !onlyWithPhoto || Boolean(record.photo)
      return matchesQuery && matchesCity && matchesPeriod && matchesPhoto
    })
  }, [cityFilter, onlyWithPhoto, periodFilter, query, records])

  const totalVolumes = useMemo(
    () => filteredRecords.reduce((total, record) => total + record.luggage.length, 0),
    [filteredRecords],
  )

  const withPhotoCount = useMemo(
    () => filteredRecords.filter((record) => Boolean(record.photo)).length,
    [filteredRecords],
  )

  const handlePrint = async () => {
    if (filteredRecords.length === 0 || printing) return

    const previousTitle = document.title
    const nativeAndroid = isNativeAndroidPrint()
    const filterName = cityFilter || (periodFilter ? TRAVEL_PERIOD_LABELS[periodFilter] : 'Geral')
    const jobName = `Relatorio_Fotografico_Bagagens_${fileNamePart(filterName)}_${reportTimestamp()}`

    let restored = false
    let focusTimer: number | undefined

    const restore = () => {
      if (restored) return
      restored = true
      setPrinting(false)
      document.title = previousTitle
      document.body.classList.remove('printing-photo-report')
      window.removeEventListener('afterprint', restore)
      window.removeEventListener('focus', handleFocus)
      if (focusTimer !== undefined) window.clearTimeout(focusTimer)
    }

    const handleFocus = () => {
      if (!nativeAndroid) return
      focusTimer = window.setTimeout(restore, 300)
    }

    try {
      setPrinting(true)
      document.title = jobName
      document.body.classList.add('printing-photo-report')

      if (nativeAndroid) window.addEventListener('focus', handleFocus)
      else window.addEventListener('afterprint', restore)

      await waitForReportImages()
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
      await printCurrentDocument(jobName)

      if (nativeAndroid) window.setTimeout(restore, 120_000)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir a impressão do relatório fotográfico.',
      )
      restore()
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" aria-hidden="true" />
        Montando relatório fotográfico...
      </div>
    )
  }

  return (
    <div className="photo-report-page">
      <style>{`
        .photo-report-page {
          display: grid;
          gap: 18px;
        }

        .photo-report-title-card,
        .photo-report-filter-card,
        .photo-report-card {
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          background: var(--surface);
          box-shadow: var(--shadow-sm);
        }

        .photo-report-title-card {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px;
        }

        .photo-report-title-card h2 {
          margin: 3px 0 5px;
          font-size: clamp(1.45rem, 5vw, 1.9rem);
        }

        .photo-report-title-card p:last-child {
          max-width: 720px;
          margin: 0;
          color: var(--ink-700);
          font-size: 0.84rem;
          line-height: 1.5;
        }

        .photo-report-title-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .photo-report-filter-card {
          display: grid;
          gap: 10px;
          padding: 14px;
        }

        .photo-report-filters {
          display: grid;
          gap: 10px;
        }

        .photo-report-search,
        .photo-report-select {
          position: relative;
          display: flex;
          min-height: 46px;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
        }

        .photo-report-search svg,
        .photo-report-select svg {
          width: 18px;
          height: 18px;
          flex: 0 0 auto;
          color: var(--ink-500);
        }

        .photo-report-search input,
        .photo-report-select select {
          width: 100%;
          border: 0;
          outline: 0;
          color: var(--ink-900);
          background: transparent;
          font: inherit;
          font-size: 0.82rem;
        }

        .photo-report-photo-toggle {
          display: flex;
          min-height: 46px;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          color: var(--ink-700);
          font-size: 0.8rem;
          font-weight: 800;
        }

        .photo-report-photo-toggle input {
          width: 18px;
          height: 18px;
        }

        .photo-report-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          padding-top: 4px;
        }

        .photo-report-summary div {
          padding: 10px;
          border-radius: 12px;
          background: #f5f7f9;
          text-align: center;
        }

        .photo-report-summary strong,
        .photo-report-summary span {
          display: block;
        }

        .photo-report-summary strong {
          color: var(--navy-950);
          font-size: 1.25rem;
        }

        .photo-report-summary span {
          margin-top: 2px;
          color: var(--ink-500);
          font-size: 0.67rem;
          font-weight: 800;
          text-transform: uppercase;
        }

        .photo-report-grid {
          display: grid;
          gap: 14px;
        }

        .photo-report-card {
          overflow: hidden;
        }

        .photo-report-card__photo {
          display: grid;
          min-height: 230px;
          place-items: center;
          background: #eef2f5;
        }

        .photo-report-card__photo img {
          display: block;
          width: 100%;
          max-height: 430px;
          object-fit: contain;
          background: #111820;
        }

        .photo-report-card__comparison {
          display: grid;
          width: 100%;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1px;
          background: #d7dfe6;
        }

        .photo-report-card__comparison figure {
          position: relative;
          margin: 0;
          background: #111820;
        }

        .photo-report-card__comparison figcaption {
          position: absolute;
          left: 8px;
          bottom: 8px;
          padding: 4px 7px;
          border-radius: 999px;
          color: #fff;
          background: rgba(13, 34, 54, 0.82);
          font-size: 0.67rem;
          font-weight: 900;
        }

        .photo-report-reconciliation {
          display: grid;
          gap: 4px;
          padding: 10px;
          border-radius: 10px;
          background: #eef7f0;
          color: var(--ink-700);
          font-size: 0.74rem;
          line-height: 1.35;
        }

        .photo-report-reconciliation.is-warning {
          background: #fff4e5;
        }

        .photo-report-reconciliation strong {
          color: var(--ink-900);
        }

        .photo-report-reconciliation span {
          display: block;
        }

        .photo-report-card__no-photo {
          display: grid;
          min-height: 230px;
          place-items: center;
          gap: 8px;
          color: var(--ink-500);
          text-align: center;
        }

        .photo-report-card__no-photo svg {
          width: 44px;
          height: 44px;
        }

        .photo-report-card__body {
          display: grid;
          gap: 10px;
          padding: 15px;
        }

        .photo-report-card__heading {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }

        .photo-report-card__heading h3 {
          margin: 0;
          color: var(--navy-950);
          font-size: 1.08rem;
        }

        .photo-report-card__heading p {
          margin: 3px 0 0;
          color: var(--ink-500);
          font-size: 0.76rem;
        }

        .photo-report-volume-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 7px 9px;
          border-radius: 999px;
          color: var(--navy-900);
          background: var(--blue-100);
          font-size: 0.76rem;
          font-weight: 900;
        }

        .photo-report-volume-badge svg {
          width: 16px;
          height: 16px;
        }

        .photo-report-meta {
          display: grid;
          gap: 6px;
          color: var(--ink-700);
          font-size: 0.77rem;
        }

        .photo-report-meta strong {
          color: var(--ink-900);
        }

        .photo-report-history {
          display: grid;
          gap: 5px;
          padding: 9px 10px;
          border-radius: 10px;
          background: #f5f7f9;
          color: var(--ink-700);
          font-size: 0.74rem;
          line-height: 1.35;
        }

        .photo-report-history strong {
          color: var(--ink-900);
        }

        .photo-report-history span {
          display: block;
        }

        .photo-report-note {
          padding: 9px 10px;
          border-radius: 10px;
          color: var(--ink-700);
          background: #fff8e8;
          font-size: 0.75rem;
          line-height: 1.4;
        }

        .photo-report-empty {
          display: grid;
          place-items: center;
          gap: 8px;
          min-height: 190px;
          padding: 20px;
          border: 1px dashed var(--line);
          border-radius: var(--radius-md);
          color: var(--ink-500);
          background: #fff;
          text-align: center;
        }

        .photo-report-empty svg {
          width: 42px;
          height: 42px;
        }

        .photo-report-print-root {
          display: none;
        }

        @media (min-width: 760px) {
          .photo-report-filters {
            grid-template-columns: 1.25fr 1fr 1fr 1fr;
          }

          .photo-report-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          body.printing-photo-report .app-header,
          body.printing-photo-report .bottom-navigation,
          body.printing-photo-report .photo-report-page > :not(.photo-report-print-root) {
            display: none !important;
          }

          body.printing-photo-report,
          body.printing-photo-report .app-shell,
          body.printing-photo-report .app-main,
          body.printing-photo-report .photo-report-page {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          body.printing-photo-report .photo-report-print-root {
            display: block !important;
          }

          body.printing-photo-report .photo-report-print-sheet {
            position: relative;
            display: flex !important;
            min-height: 281mm;
            flex-direction: column;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
            color: #0d2236;
            background: #fff;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          body.printing-photo-report .photo-report-print-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          body.printing-photo-report .photo-report-print-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8mm;
            padding-bottom: 4mm;
            border-bottom: 1.2mm solid #153550;
          }

          body.printing-photo-report .photo-report-print-header img {
            width: 32mm;
            max-height: 25mm;
            object-fit: contain;
          }

          body.printing-photo-report .photo-report-print-header h1 {
            margin: 1mm 0 0;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 19pt;
            line-height: 1.05;
          }

          body.printing-photo-report .photo-report-print-header p,
          body.printing-photo-report .photo-report-print-header span {
            margin: 0;
            color: #425466;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 8pt;
          }

          body.printing-photo-report .photo-report-print-photo {
            display: grid;
            height: 156mm;
            margin-top: 5mm;
            place-items: center;
            overflow: hidden;
            border: 0.5mm solid #cbd5df;
            border-radius: 3mm;
            background: #eef2f5;
          }

          body.printing-photo-report .photo-report-print-photo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #111820;
          }

          body.printing-photo-report .photo-report-print-photo-comparison {
            display: grid;
            width: 100%;
            height: 100%;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.8mm;
            background: #cbd5df;
          }

          body.printing-photo-report .photo-report-print-photo-comparison figure {
            position: relative;
            margin: 0;
            overflow: hidden;
            background: #111820;
          }

          body.printing-photo-report .photo-report-print-photo-comparison figcaption {
            position: absolute;
            left: 2mm;
            bottom: 2mm;
            padding: 1mm 2mm;
            border-radius: 2mm;
            color: #fff;
            background: rgba(13, 34, 54, 0.85);
            font-family: Arial, Helvetica, sans-serif;
            font-size: 7pt;
            font-weight: 800;
          }

          body.printing-photo-report .photo-report-print-no-photo {
            display: grid;
            width: 100%;
            height: 100%;
            place-items: center;
            color: #647484;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 15pt;
            font-weight: 800;
            text-align: center;
          }

          body.printing-photo-report .photo-report-print-data {
            display: grid;
            grid-template-columns: 1.3fr 0.7fr;
            gap: 4mm;
            margin-top: 5mm;
          }

          body.printing-photo-report .photo-report-print-data > div {
            padding: 3.2mm;
            border: 0.4mm solid #cbd5df;
            border-radius: 2.5mm;
          }

          body.printing-photo-report .photo-report-print-data strong,
          body.printing-photo-report .photo-report-print-data span,
          body.printing-photo-report .photo-report-print-data small {
            display: block;
            font-family: Arial, Helvetica, sans-serif;
          }

          body.printing-photo-report .photo-report-print-data strong {
            font-size: 11pt;
          }

          body.printing-photo-report .photo-report-print-data span,
          body.printing-photo-report .photo-report-print-data small {
            margin-top: 1mm;
            color: #425466;
            font-size: 8pt;
            line-height: 1.35;
          }

          body.printing-photo-report .photo-report-print-count {
            display: grid;
            place-items: center;
            text-align: center;
          }

          body.printing-photo-report .photo-report-print-count b {
            display: block;
            color: #153550;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 31pt;
            line-height: 1;
          }

          body.printing-photo-report .photo-report-print-count span {
            margin-top: 2mm;
            font-size: 9pt;
            font-weight: 800;
            text-transform: uppercase;
          }

          body.printing-photo-report .photo-report-print-history {
            display: grid;
            gap: 1mm;
            margin-top: 3mm;
            padding: 2.5mm 3mm;
            border: 0.35mm solid #d7dfe6;
            border-radius: 2mm;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 7pt;
            line-height: 1.25;
          }

          body.printing-photo-report .photo-report-print-history strong {
            font-size: 8pt;
          }

          body.printing-photo-report .photo-report-print-history span {
            display: block;
            color: #425466;
          }

          body.printing-photo-report .photo-report-print-footer {
            margin-top: auto;
            padding-top: 3mm;
            border-top: 0.3mm solid #d7dfe6;
            color: #647484;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 6.8pt;
            line-height: 1.35;
          }
        }
      `}</style>

      <section className="photo-report-title-card">
        <div>
          <p className="eyebrow">Reconhecimento visual</p>
          <h2>Relatório fotográfico das bagagens</h2>
          <p>
            Consulte a foto original do conjunto de cada passageiro e gere um PDF para levar a Barretos.
            O relatório usa as fotos já salvas no aplicativo e não altera nenhum cadastro.
          </p>
        </div>
        <div className="photo-report-title-actions">
          <button type="button" className="secondary-button" onClick={() => void loadReport()}>
            <RefreshCcw aria-hidden="true" />
            Atualizar
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handlePrint()}
            disabled={filteredRecords.length === 0 || printing}
          >
            {printing ? <LoaderCircle className="spin" aria-hidden="true" /> : <Printer aria-hidden="true" />}
            {printing ? 'Preparando...' : 'Imprimir / Salvar PDF'}
          </button>
        </div>
      </section>

      {errorMessage ? <div className="alert alert--danger">{errorMessage}</div> : null}

      <section className="photo-report-filter-card">
        <div className="photo-report-filters">
          <label className="photo-report-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar passageiro"
            />
          </label>

          <label className="photo-report-select">
            <MapPin aria-hidden="true" />
            <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
              <option value="">Todas as cidades</option>
              {cities.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>

          <label className="photo-report-select">
            <BriefcaseBusiness aria-hidden="true" />
            <select
              value={periodFilter}
              onChange={(event) => setPeriodFilter(event.target.value as TravelPeriod | '')}
            >
              <option value="">Todos os períodos</option>
              <option value="FIRST_WEEK">1ª semana</option>
              <option value="SECOND_WEEK">2ª semana</option>
              <option value="BOTH_WEEKS">Duas semanas</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </label>

          <label className="photo-report-photo-toggle">
            <input
              type="checkbox"
              checked={onlyWithPhoto}
              onChange={(event) => setOnlyWithPhoto(event.target.checked)}
            />
            Somente com foto
          </label>
        </div>

        <div className="photo-report-summary">
          <div><strong>{filteredRecords.length}</strong><span>passageiros</span></div>
          <div><strong>{totalVolumes}</strong><span>volumes</span></div>
          <div><strong>{withPhotoCount}</strong><span>com foto</span></div>
        </div>
      </section>

      {filteredRecords.length === 0 ? (
        <section className="photo-report-empty">
          <ImageOff aria-hidden="true" />
          <strong>Nenhum conjunto encontrado com estes filtros.</strong>
          <span>Desmarque “Somente com foto” ou altere cidade/período.</span>
        </section>
      ) : (
        <section className="photo-report-grid">
          {filteredRecords.map((record) => {
            const notes = luggageNotes(record)
            const photoUrl = record.photo ? photoUrls[record.photo.id] : ''
            const latest = latestMovement(record)
            const history = movementGroups(record)
            const reconciliation = latestReconciliation(record)
            const reconciliationPhoto = reconciliation
              ? record.reconciliationPhotos.find((item) => item.id === reconciliation.photoId)
              : undefined
            const reconciliationPhotoUrl = reconciliationPhoto
              ? photoUrls[reconciliationPhoto.id]
              : ''
            return (
              <article className="photo-report-card" key={record.passenger.id}>
                <div className="photo-report-card__photo">
                  {reconciliationPhotoUrl ? (
                    <div className="photo-report-card__comparison">
                      <figure>
                        {photoUrl ? (
                          <img src={photoUrl} alt={`Saída de ${record.passenger.fullName}`} />
                        ) : (
                          <div className="photo-report-card__no-photo">Sem foto de saída</div>
                        )}
                        <figcaption>Saída</figcaption>
                      </figure>
                      <figure>
                        <img
                          src={reconciliationPhotoUrl}
                          alt={`Recolhimento de ${record.passenger.fullName}`}
                        />
                        <figcaption>Recolhimento</figcaption>
                      </figure>
                    </div>
                  ) : photoUrl ? (
                    <img src={photoUrl} alt={`Conjunto de bagagens de ${record.passenger.fullName}`} />
                  ) : (
                    <div className="photo-report-card__no-photo">
                      <ImageOff aria-hidden="true" />
                      <strong>Sem foto do conjunto</strong>
                    </div>
                  )}
                </div>
                <div className="photo-report-card__body">
                  <div className="photo-report-card__heading">
                    <div>
                      <h3>{record.passenger.fullName}</h3>
                      <p>{record.passenger.city} • {TRAVEL_PERIOD_LABELS[record.passenger.travelPeriod]}</p>
                    </div>
                    <span className="photo-report-volume-badge">
                      <BriefcaseBusiness aria-hidden="true" />
                      {record.luggage.length} {record.luggage.length === 1 ? 'volume' : 'volumes'}
                    </span>
                  </div>
                  <div className="photo-report-meta">
                    <span><strong>Situação atual:</strong> {stageSummary(record.passenger) || 'Sem etapa registrada'}</span>
                    {latest ? (
                      <span>
                        <strong>Última movimentação:</strong> {MOVEMENT_LABELS[latest.type]} • {movementTime(latest.occurredAt)}
                      </span>
                    ) : null}
                    {record.passenger.phone ? <span><strong>Telefone:</strong> {record.passenger.phone}</span> : null}
                  </div>
                  {reconciliation ? (
                    <div className={`photo-report-reconciliation ${reconciliation.result === 'POSSIBLE_MISSING' ? 'is-warning' : ''}`}>
                      <strong>Conferência do conjunto no retorno</strong>
                      <span>
                        Saída: {reconciliation.originalQuantity} · Observados no retorno: {reconciliation.observedQuantity}
                      </span>
                      <span>Resultado: {SET_RECONCILIATION_LABELS[reconciliation.result]}</span>
                      <span>Conferido em: {movementTime(reconciliation.checkedAt)}</span>
                      {reconciliation.note ? <span>Obs.: {reconciliation.note}</span> : null}
                    </div>
                  ) : null}
                  {history.length > 0 ? (
                    <div className="photo-report-history">
                      <strong>Histórico das movimentações</strong>
                      {history.map((item) => (
                        <span key={`${record.passenger.id}-${item.type}`}>
                          {item.label}: {item.count} {item.count === 1 ? 'volume' : 'volumes'} • {item.timeLabel}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {notes ? <div className="photo-report-note"><strong>Observações dos volumes:</strong> {notes}</div> : null}
                </div>
              </article>
            )
          })}
        </section>
      )}

      <section className="safety-note">
        <Camera aria-hidden="true" />
        <div>
          <strong>A foto vira referência de reconhecimento</strong>
          <p>
            Este relatório mostra o conjunto vinculado ao passageiro. Ele não afirma que códigos digitados
            anteriormente sejam lacres físicos nem substitui a conferência da carga.
          </p>
        </div>
      </section>

      <section className="photo-report-print-root" aria-hidden="true">
        {filteredRecords.map((record, index) => {
          const notes = luggageNotes(record)
          const photoUrl = record.photo ? photoUrls[record.photo.id] : ''
          const latest = latestMovement(record)
          const history = movementGroups(record)
          const reconciliation = latestReconciliation(record)
          const reconciliationPhoto = reconciliation
            ? record.reconciliationPhotos.find((item) => item.id === reconciliation.photoId)
            : undefined
          const reconciliationPhotoUrl = reconciliationPhoto
            ? photoUrls[reconciliationPhoto.id]
            : ''
          return (
            <article className="photo-report-print-sheet" key={`photo-print-${record.passenger.id}`}>
              <header className="photo-report-print-header">
                <div>
                  <p>CARAVANA FLÁVIO GONÇALVES • BARRETÃO 2026</p>
                  <h1>{record.passenger.fullName}</h1>
                  <span>{record.passenger.city} • {TRAVEL_PERIOD_LABELS[record.passenger.travelPeriod]}</span>
                </div>
                <img src="/logo.png" alt="" />
              </header>

              <div className="photo-report-print-photo">
                {reconciliationPhotoUrl ? (
                  <div className="photo-report-print-photo-comparison">
                    <figure>
                      {photoUrl ? (
                        <img src={photoUrl} alt="" />
                      ) : (
                        <div className="photo-report-print-no-photo">SEM FOTO DE SAÍDA</div>
                      )}
                      <figcaption>Saída</figcaption>
                    </figure>
                    <figure>
                      <img src={reconciliationPhotoUrl} alt="" />
                      <figcaption>Recolhimento</figcaption>
                    </figure>
                  </div>
                ) : photoUrl ? (
                  <img src={photoUrl} alt="" />
                ) : (
                  <div className="photo-report-print-no-photo">SEM FOTO DO CONJUNTO</div>
                )}
              </div>

              <div className="photo-report-print-data">
                <div>
                  <strong>Reconhecimento do conjunto</strong>
                  <span>Situação atual: {stageSummary(record.passenger) || 'Sem etapa registrada'}</span>
                  {latest ? <small>Última movimentação: {MOVEMENT_LABELS[latest.type]} • {movementTime(latest.occurredAt)}</small> : null}
                  {reconciliation ? (
                    <>
                      <small>
                        Retorno do conjunto: saída {reconciliation.originalQuantity} · observado {reconciliation.observedQuantity}
                      </small>
                      <small>Resultado: {SET_RECONCILIATION_LABELS[reconciliation.result]} · {movementTime(reconciliation.checkedAt)}</small>
                      {reconciliation.note ? <small>Reconciliação: {reconciliation.note}</small> : null}
                    </>
                  ) : null}
                  {record.passenger.phone ? <small>Telefone: {record.passenger.phone}</small> : null}
                  {notes ? <small>Obs.: {notes}</small> : null}
                </div>
                <div className="photo-report-print-count">
                  <b>{record.luggage.length}</b>
                  <span>{record.luggage.length === 1 ? 'volume cadastrado' : 'volumes cadastrados'}</span>
                </div>
              </div>

              {history.length > 0 ? (
                <div className="photo-report-print-history">
                  <strong>Histórico das movimentações</strong>
                  {history.map((item) => (
                    <span key={`print-${record.passenger.id}-${item.type}`}>
                      {item.label}: {item.count} {item.count === 1 ? 'volume' : 'volumes'} • {item.timeLabel}
                    </span>
                  ))}
                </div>
              ) : null}

              <footer className="photo-report-print-footer">
                Página {index + 1} de {filteredRecords.length}. Registro operacional de reconhecimento visual.
                A quantidade corresponde aos volumes cadastrados no aplicativo; a foto representa o conjunto do passageiro
                e não comprova identificação física individual de cada volume.
              </footer>
            </article>
          )
        })}
      </section>
    </div>
  )
}
