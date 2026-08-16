import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  MapPin,
  Printer,
  RefreshCcw,
  ShieldCheck,
  Truck,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CITIES } from '../constants/cities'
import { STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import { getContingencySnapshot } from '../data/repository'
import type {
  ContingencyLuggageRow,
  ContingencySnapshot,
  LuggageMovement,
  OperationKey,
  TravelPeriod,
} from '../domain/types'
import { createContingencyWorkbook } from '../utils/contingencyWorkbook'
import { createTransportManifestWorkbook } from '../utils/transportManifestWorkbook'
import { downloadBlobFile } from '../utils/fileDownload'
import { isNativeAndroidPrint, printCurrentDocument } from '../utils/nativePrint'

const LAST_EXPORT_KEY = 'bagagens-barretao:last-contingency-export'

interface LastExportMetadata {
  generatedAt: string
  latestDataAt: string
  passengerCount: number
  luggageCount: number
  filename: string
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function fileTimestamp(value: string) {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function readLastExport() {
  try {
    const raw = localStorage.getItem(LAST_EXPORT_KEY)
    return raw ? (JSON.parse(raw) as LastExportMetadata) : null
  } catch {
    return null
  }
}

function movementForOperation(
  row: ContingencyLuggageRow,
  operationKey: OperationKey,
): LuggageMovement | undefined {
  const exact = row.movements.find((movement) => movement.operationKey === operationKey)
  if (exact) return exact

  const period = row.passenger.travelPeriod
  return row.movements.find((movement) => {
    if (operationKey === 'WAREHOUSE_TO_TRAILER') return movement.type === 'WAREHOUSE_TO_TRAILER'
    if (operationKey === 'TRAILER_TO_WAREHOUSE') return movement.type === 'TRAILER_TO_WAREHOUSE'
    if (movement.type === 'TRAILER_TO_PASSENGER') {
      return period === 'SECOND_WEEK'
        ? operationKey === 'DELIVER_SECOND_WEEK'
        : operationKey === 'DELIVER_FIRST_WEEK'
    }
    if (movement.type === 'PASSENGER_TO_TRAILER') {
      return period === 'FIRST_WEEK'
        ? operationKey === 'COLLECT_FIRST_WEEK'
        : operationKey === 'COLLECT_SECOND_WEEK'
    }
    return false
  })
}

function isApplicable(period: TravelPeriod, operationKey: OperationKey) {
  if (operationKey === 'WAREHOUSE_TO_TRAILER' || operationKey === 'TRAILER_TO_WAREHOUSE') return true
  if (operationKey === 'DELIVER_FIRST_WEEK') return period !== 'SECOND_WEEK'
  if (operationKey === 'COLLECT_FIRST_WEEK') return period === 'FIRST_WEEK'
  if (operationKey === 'DELIVER_SECOND_WEEK') return period === 'SECOND_WEEK'
  return period !== 'FIRST_WEEK'
}

function compactDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function printOperationValue(row: ContingencyLuggageRow, operationKey: OperationKey) {
  if (!isApplicable(row.passenger.travelPeriod, operationKey)) return 'N/A'
  const movement = movementForOperation(row, operationKey)
  return movement ? `✓ ${compactDate(movement.occurredAt)}` : '☐'
}

function printRegisteredValue(row: ContingencyLuggageRow) {
  const movement = row.movements.find((item) => item.type === 'REGISTERED_AT_WAREHOUSE')
  return movement ? `✓ ${compactDate(movement.occurredAt)}` : '☐'
}

function printCityValue(row: ContingencyLuggageRow) {
  const movement = row.movements.find((item) => item.type === 'WAREHOUSE_TO_CITY')
  return movement ? `✓ ${compactDate(movement.occurredAt)}` : '☐'
}

interface TransportManifestRow {
  passenger: ContingencyLuggageRow['passenger']
  luggageCodes: string[]
}

function isInternalControlCode(code: string) {
  return code.startsWith('SEM-LACRE-')
}

function manifestPhysicalIdentification(codes: string[]) {
  const physicalCodes = codes.filter((code) => !isInternalControlCode(code))
  return physicalCodes.length > 0 ? physicalCodes.join(', ') : 'Sem identificação física'
}

function manifestInternalControlLabel(codes: string[]) {
  const internalCount = codes.filter(isInternalControlCode).length
  if (internalCount === 0) return 'Identificação física informada'
  return `${internalCount} ${internalCount === 1 ? 'volume sem lacre físico' : 'volumes sem lacre físico'} · controle interno no aplicativo`
}

function manifestDocumentLabel(passenger: ContingencyLuggageRow['passenger']) {
  if (!passenger.documentNumber.trim()) return 'Não informado'
  const prefix = passenger.documentType === 'UNKNOWN' ? 'DOC' : passenger.documentType
  return `${prefix}: ${passenger.documentNumber}`
}

function buildTransportManifestRows(snapshot: ContingencySnapshot): TransportManifestRow[] {
  const grouped = new Map<string, TransportManifestRow>()

  for (const row of snapshot.luggageRows) {
    const current = grouped.get(row.passenger.id) ?? {
      passenger: row.passenger,
      luggageCodes: [],
    }
    current.luggageCodes.push(row.luggage.code)
    grouped.set(row.passenger.id, current)
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      luggageCodes: [...item.luggageCodes].sort((a, b) =>
        a.localeCompare(b, 'pt-BR', { numeric: true }),
      ),
    }))
    .sort((a, b) => {
      const city = a.passenger.city.localeCompare(b.passenger.city, 'pt-BR')
      return city || a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR')
    })
}

export function ContingencyPage() {
  const [snapshot, setSnapshot] = useState<ContingencySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatingManifest, setGeneratingManifest] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [lastExport, setLastExport] = useState<LastExportMetadata | null>(() => readLastExport())
  const [cityFilter, setCityFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState<TravelPeriod | ''>('')

  const loadSnapshot = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage('')
      setSnapshot(await getContingencySnapshot())
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar o plano de contingência.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSnapshot()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadSnapshot])

  const filteredRows = useMemo(() => {
    if (!snapshot) return []
    return snapshot.luggageRows.filter((row) => {
      const matchesCity = !cityFilter || row.passenger.city === cityFilter
      const matchesPeriod = !periodFilter || row.passenger.travelPeriod === periodFilter
      return matchesCity && matchesPeriod
    })
  }, [cityFilter, periodFilter, snapshot])

  const transportManifestRows = useMemo(
    () => (snapshot ? buildTransportManifestRows(snapshot) : []),
    [snapshot],
  )

  const transportManifestLuggageCount = useMemo(
    () => transportManifestRows.reduce((total, row) => total + row.luggageCodes.length, 0),
    [transportManifestRows],
  )

  const isExportCurrent = Boolean(
    snapshot && lastExport && lastExport.latestDataAt === snapshot.latestDataAt,
  )

  const handleGenerateExcel = async () => {
    if (!snapshot) return
    try {
      setGenerating(true)
      setErrorMessage('')
      setSuccessMessage('')
      const filename = `Plano_de_Contingencia_Bagagens_Barretao_${fileTimestamp(snapshot.generatedAt)}.xlsx`
      const blob = await createContingencyWorkbook(snapshot)
      const downloadResult = await downloadBlobFile(blob, filename)
      const metadata: LastExportMetadata = {
        generatedAt: new Date().toISOString(),
        latestDataAt: snapshot.latestDataAt,
        passengerCount: snapshot.passengerCount,
        luggageCount: snapshot.luggageCount,
        filename,
      }
      localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(metadata))
      setLastExport(metadata)
      setSuccessMessage(
        downloadResult.native && downloadResult.displayPath
          ? `Planilha Excel salva em ${downloadResult.displayPath}.`
          : 'Planilha Excel gerada e baixada. Guarde uma cópia fora deste aparelho.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível gerar a planilha Excel.',
      )
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateTransportManifest = async () => {
    if (!snapshot || transportManifestRows.length === 0) return

    try {
      setGeneratingManifest(true)
      setErrorMessage('')
      setSuccessMessage('')

      const { blob, fileName } = await createTransportManifestWorkbook(snapshot)
      const result = await downloadBlobFile(blob, fileName)

      setSuccessMessage(
        result.native && result.displayPath
          ? `Manifesto da carreta salvo em ${result.displayPath}.`
          : 'Manifesto da carreta gerado e baixado.',
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível gerar o manifesto da carreta.',
      )
    } finally {
      setGeneratingManifest(false)
    }
  }

  const handlePrintTransportManifest = () => {
    if (!snapshot || transportManifestRows.length === 0) return

    const previousTitle = document.title
    const jobName = `Manifesto_Carreta_Barretao_${fileTimestamp(new Date().toISOString())}`
    const nativeAndroid = isNativeAndroidPrint()
    let restored = false
    let focusTimer: number | undefined

    const restore = () => {
      if (restored) return
      restored = true
      document.title = previousTitle
      document.body.classList.remove('printing-transport-manifest')
      window.removeEventListener('afterprint', restore)
      window.removeEventListener('focus', handleFocus)
      if (focusTimer !== undefined) window.clearTimeout(focusTimer)
    }

    const handleFocus = () => {
      if (!nativeAndroid) return
      focusTimer = window.setTimeout(restore, 300)
    }

    document.title = jobName
    document.body.classList.add('printing-transport-manifest')

    if (nativeAndroid) {
      window.addEventListener('focus', handleFocus)
    } else {
      window.addEventListener('afterprint', restore)
    }

    window.setTimeout(() => {
      void printCurrentDocument(jobName).catch((error) => {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível abrir a impressão do manifesto da carreta.',
        )
        restore()
      })
    }, 120)

    if (nativeAndroid) {
      window.setTimeout(restore, 120_000)
    }
  }

  const handlePrint = () => {
    if (!snapshot) return
    const previousTitle = document.title
    const filterName = cityFilter || (periodFilter ? TRAVEL_PERIOD_LABELS[periodFilter] : 'Geral')
    const jobName = `Controle_Manual_Bagagens_${filterName.replace(/\s+/g, '_')}_${fileTimestamp(new Date().toISOString())}`
    document.title = jobName

    if (isNativeAndroidPrint()) {
      void printCurrentDocument(jobName)
        .catch((error) => {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Não foi possível abrir a impressão do controle manual.',
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

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" aria-hidden="true" />
        Preparando o plano de contingência...
      </div>
    )
  }

  if (!snapshot) {
    return <div className="alert alert--danger">{errorMessage || 'Plano indisponível.'}</div>
  }

  return (
    <div className="contingency-page">
      <section className="page-title-card contingency-title-card">
        <div>
          <p className="eyebrow">Paraquedas operacional</p>
          <h2>Plano de contingência</h2>
          <p>Exporte uma planilha completa para continuar o controle manualmente se o aplicativo falhar.</p>
        </div>
        <div className="contingency-actions">
          <button type="button" className="secondary-button" onClick={() => void loadSnapshot()}>
            <RefreshCcw aria-hidden="true" />
            Atualizar dados
          </button>
          <button type="button" className="secondary-button" onClick={handlePrint} disabled={filteredRows.length === 0}>
            <Printer aria-hidden="true" />
            Imprimir controle
          </button>
          <button type="button" className="primary-button" onClick={() => void handleGenerateExcel()} disabled={generating}>
            {generating ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            {generating ? 'Gerando Excel...' : 'Gerar planilha Excel'}
          </button>
        </div>
      </section>

      {errorMessage ? <div className="alert alert--danger">{errorMessage}</div> : null}
      {successMessage ? (
        <div className="contingency-feedback is-success">
          <CheckCircle2 aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <section className={`contingency-export-status ${isExportCurrent ? 'is-current' : 'is-outdated'}`}>
        {isExportCurrent ? <ShieldCheck aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
        <div>
          <strong>
            {!lastExport
              ? 'Nenhuma planilha de contingência foi gerada'
              : isExportCurrent
                ? 'Planilha de contingência atualizada'
                : 'Planilha de contingência desatualizada'}
          </strong>
          <p>
            {lastExport
              ? `Última geração: ${formatDateTime(lastExport.generatedAt)} · ${lastExport.passengerCount} passageiros · ${lastExport.luggageCount} bagagens.`
              : 'Gere a primeira cópia antes de iniciar uma operação real.'}
          </p>
        </div>
      </section>

      <section className="contingency-info-card">
        <Truck aria-hidden="true" />
        <div>
          <strong>Manifesto da carreta</strong>
          <p>
            Registro operacional para transporte com nome, CPF/documento, telefone, cidade,
            período, quantidade de volumes cadastrados e identificação física quando houver.
            Códigos internos do aplicativo não são apresentados como lacres físicos.
          </p>
          <small>
            Gere novamente depois da conferência final da carga para que o documento reflita
            os registros mais recentes do aplicativo. A fotografia do conjunto, quando cadastrada,
            permanece no aplicativo como referência visual.
          </small>
        </div>
        <div className="contingency-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleGenerateTransportManifest()}
            disabled={transportManifestRows.length === 0 || generatingManifest}
          >
            {generatingManifest
              ? <LoaderCircle className="spin" aria-hidden="true" />
              : <Download aria-hidden="true" />}
            {generatingManifest ? 'Gerando manifesto...' : 'Baixar manifesto Excel'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handlePrintTransportManifest}
            disabled={transportManifestRows.length === 0}
          >
            <Printer aria-hidden="true" />
            Imprimir / Salvar PDF
          </button>
        </div>
      </section>

      <section className="contingency-summary-grid">
        <ContingencySummary icon={<UsersRound />} label="Passageiros" value={snapshot.passengerCount} />
        <ContingencySummary icon={<BriefcaseBusiness />} label="Bagagens" value={snapshot.luggageCount} />
        <ContingencySummary icon={<Clock3 />} label="Última alteração" value={formatDateTime(snapshot.latestDataAt)} compact />
        <ContingencySummary icon={<FileSpreadsheet />} label="Abas por cidade" value={snapshot.citySummaries.filter((item) => item.luggageCount > 0).length} />
      </section>

      <section className="contingency-info-card">
        <FileSpreadsheet aria-hidden="true" />
        <div>
          <strong>O Excel sempre inclui todos os dados</strong>
          <p>Os filtros abaixo afetam apenas a prévia e a impressão. O arquivo Excel contém controle geral, passageiros, resumo, instruções e uma aba para cada cidade com bagagens.</p>
        </div>
      </section>

      <section className="contingency-filter-card">
        <label className="select-field">
          <MapPin aria-hidden="true" />
          <select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}>
            <option value="">Todas as cidades</option>
            {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <label className="select-field">
          <UsersRound aria-hidden="true" />
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as TravelPeriod | '')}>
            <option value="">Todos os períodos</option>
            <option value="FIRST_WEEK">1ª semana</option>
            <option value="SECOND_WEEK">2ª semana</option>
            <option value="BOTH_WEEKS">Duas semanas</option>
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        <div className="contingency-filter-result">
          <strong>{filteredRows.length}</strong>
          <span>{filteredRows.length === 1 ? 'bagagem na seleção' : 'bagagens na seleção'}</span>
        </div>
      </section>

      <section className="contingency-preview-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Prévia da seleção</p>
            <h2>Linhas do controle manual</h2>
          </div>
          {filteredRows.length > 100 ? <span className="operation-list-count">Primeiras 100</span> : null}
        </div>

        {filteredRows.length === 0 ? (
          <section className="empty-state contingency-empty-state">
            <BriefcaseBusiness aria-hidden="true" />
            <h3>Nenhuma bagagem nesta seleção</h3>
            <p>Altere a cidade ou o período para visualizar os volumes.</p>
          </section>
        ) : (
          <div className="contingency-table-wrap">
            <table className="contingency-table">
              <thead>
                <tr>
                  <th>Cidade</th>
                  <th>Passageiro</th>
                  <th>Lacre</th>
                  <th>Período</th>
                  <th>Status atual</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.slice(0, 100).map((row) => (
                  <tr key={row.luggage.id}>
                    <td>{row.passenger.city}</td>
                    <td>{row.passenger.fullName}</td>
                    <td><strong>{row.luggage.code}</strong></td>
                    <td>{TRAVEL_PERIOD_LABELS[row.passenger.travelPeriod]}</td>
                    <td>{STAGE_LABELS[row.luggage.currentStage]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style>{`
        .transport-manifest-print {
          display: none;
        }

        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }

          body.printing-transport-manifest .contingency-print:not(.transport-manifest-print) {
            display: none !important;
          }

          body.printing-transport-manifest .transport-manifest-print {
            display: block !important;
          }

          body.printing-transport-manifest .transport-manifest-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          body.printing-transport-manifest .transport-manifest-table thead {
            display: table-header-group;
          }

          body.printing-transport-manifest .transport-manifest-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          body.printing-transport-manifest .transport-manifest-table th,
          body.printing-transport-manifest .transport-manifest-table td {
            padding: 1.5mm 1.6mm;
            border: 1px solid #aebbc6;
            vertical-align: top;
            font-size: 7pt;
            line-height: 1.22;
            word-break: break-word;
          }

          body.printing-transport-manifest .transport-manifest-table th {
            color: #fff;
            background: #153550;
            font-weight: 700;
            text-align: left;
          }

          body.printing-transport-manifest .transport-manifest-table tbody tr:nth-child(even) td {
            background: #f6f8fa;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(1),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(1) {
            width: 7mm;
            text-align: center;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(2),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(2) {
            width: 38mm;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(3),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(3) {
            width: 29mm;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(4),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(4) {
            width: 25mm;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(5),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(5) {
            width: 29mm;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(6),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(6) {
            width: 18mm;
            text-align: center;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(7),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(7) {
            width: 48mm;
          }

          body.printing-transport-manifest .transport-manifest-table th:nth-child(8),
          body.printing-transport-manifest .transport-manifest-table td:nth-child(8) {
            width: 45mm;
          }

          body.printing-transport-manifest .transport-manifest-summary {
            display: flex;
            gap: 8mm;
            margin: 0 0 3mm;
            padding: 2.5mm 3mm;
            border: 1px solid #cbd5df;
            background: #f5f7f9;
          }

          body.printing-transport-manifest .transport-manifest-summary strong,
          body.printing-transport-manifest .transport-manifest-summary span {
            display: block;
          }

          body.printing-transport-manifest .transport-manifest-summary span {
            color: #425466;
            font-size: 6.5pt;
          }

          body.printing-transport-manifest .transport-manifest-note {
            margin: 2.5mm 0 0;
            color: #425466;
            font-size: 6.3pt;
            line-height: 1.35;
          }
        }
      `}</style>

      <section className="contingency-print transport-manifest-print" aria-hidden="true">
        <header className="contingency-print__header">
          <div>
            <p>Caravana Flávio Gonçalves · Barretão 2026</p>
            <h1>Manifesto da carreta</h1>
            <span>Registro Operacional de Vinculação de Bagagens</span>
          </div>
          <div>
            <strong>Gerado em</strong>
            <span>{formatDateTime(snapshot.generatedAt)}</span>
            <small>{transportManifestRows.length} passageiros · {transportManifestLuggageCount} volumes</small>
          </div>
        </header>

        <div className="transport-manifest-summary">
          <div>
            <span>Passageiros com bagagem</span>
            <strong>{transportManifestRows.length}</strong>
          </div>
          <div>
            <span>Total de volumes</span>
            <strong>{transportManifestLuggageCount}</strong>
          </div>
          <div>
            <span>Última alteração da base</span>
            <strong>{formatDateTime(snapshot.latestDataAt)}</strong>
          </div>
        </div>

        <table className="transport-manifest-table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Passageiro</th>
              <th>CPF / Documento</th>
              <th>Telefone</th>
              <th>Cidade · Período</th>
              <th>Volumes cadastrados</th>
              <th>Identificação física quando houver</th>
              <th>Controle interno</th>
            </tr>
          </thead>
          <tbody>
            {transportManifestRows.map((row, index) => (
              <tr key={`manifest-${row.passenger.id}`}>
                <td>{index + 1}</td>
                <td><strong>{row.passenger.fullName}</strong></td>
                <td>{manifestDocumentLabel(row.passenger)}</td>
                <td>{row.passenger.phone || 'Não informado'}</td>
                <td>
                  {row.passenger.city}<br />
                  {TRAVEL_PERIOD_LABELS[row.passenger.travelPeriod]}
                </td>
                <td><strong>{row.luggageCodes.length}</strong></td>
                <td>{manifestPhysicalIdentification(row.luggageCodes)}</td>
                <td>{manifestInternalControlLabel(row.luggageCodes)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="transport-manifest-note">
          Registro operacional gerado a partir dos dados do aplicativo. A vinculação principal é feita
          pelo passageiro, documento e quantidade de volumes cadastrados; a identificação física é
          informada somente quando existir. Registros “Sem lacre físico” usam controle interno e não
          significam que exista etiqueta ou lacre no volume. A fotografia do conjunto, quando cadastrada,
          permanece no aplicativo como referência visual. Este documento não substitui documentos fiscais,
          autorizações, exigências legais/regulatórias aplicáveis ao transporte nem constitui termo de isenção
          de responsabilidade. Recomenda-se conferir a carga física antes da saída e gerar nova versão após
          qualquer alteração.
        </p>
      </section>

      <section className="contingency-print" aria-hidden="true">
        <header className="contingency-print__header">
          <div>
            <p>Caravana Flávio Gonçalves</p>
            <h1>Controle manual das bagagens</h1>
            <span>{cityFilter || 'Todas as cidades'} · {periodFilter ? TRAVEL_PERIOD_LABELS[periodFilter] : 'Todos os períodos'}</span>
          </div>
          <div>
            <strong>Gerado em</strong>
            <span>{formatDateTime(snapshot.generatedAt)}</span>
            <small>{filteredRows.length} bagagens</small>
          </div>
        </header>
        <p className="contingency-print__instruction">Marque as caixas ou anote data e horário. N/A significa que a etapa não pertence ao período do passageiro.</p>
        <table className="contingency-print-table">
          <thead>
            <tr>
              <th>Cidade</th>
              <th>Passageiro</th>
              <th>Lacre</th>
              <th>Período</th>
              <th>Galpão</th>
              <th>Carreta</th>
              <th>Entrega 1ª</th>
              <th>Recolh. 1ª</th>
              <th>Entrega 2ª</th>
              <th>Recolh. final</th>
              <th>Retorno</th>
              <th>Cidade</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.luggage.id}>
                <td>{row.passenger.city}</td>
                <td>{row.passenger.fullName}</td>
                <td>{row.luggage.code}</td>
                <td>{TRAVEL_PERIOD_LABELS[row.passenger.travelPeriod]}</td>
                <td>{printRegisteredValue(row)}</td>
                <td>{printOperationValue(row, 'WAREHOUSE_TO_TRAILER')}</td>
                <td>{printOperationValue(row, 'DELIVER_FIRST_WEEK')}</td>
                <td>{printOperationValue(row, 'COLLECT_FIRST_WEEK')}</td>
                <td>{printOperationValue(row, 'DELIVER_SECOND_WEEK')}</td>
                <td>{printOperationValue(row, 'COLLECT_SECOND_WEEK')}</td>
                <td>{printOperationValue(row, 'TRAILER_TO_WAREHOUSE')}</td>
                <td>{printCityValue(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function ContingencySummary({
  icon,
  label,
  value,
  compact = false,
}: {
  icon: ReactNode
  label: string
  value: number | string
  compact?: boolean
}) {
  return (
    <article className="contingency-summary-card">
      <div>{icon}</div>
      <span>{label}</span>
      <strong className={compact ? 'is-compact' : undefined}>{value}</strong>
    </article>
  )
}
