import {
  CheckSquare,
  Layers3,
  LoaderCircle,
  MapPinned,
  Printer,
  Square,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import { listPassengers } from '../data/repository'
import type { PassengerSummary, TravelPeriod } from '../domain/types'
import { isNativeAndroidPrint, printCurrentDocument } from '../utils/nativePrint'

type PeriodFilter = TravelPeriod | 'ALL'

interface SignItem {
  city: string
  period: TravelPeriod
}

const PERIOD_ORDER: TravelPeriod[] = ['FIRST_WEEK', 'SECOND_WEEK', 'BOTH_WEEKS']

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: 'FIRST_WEEK', label: '1ª semana' },
  { value: 'SECOND_WEEK', label: '2ª semana' },
  { value: 'BOTH_WEEKS', label: 'Duas semanas' },
  { value: 'ALL', label: 'Todos os períodos' },
]

function citiesForPeriod(passengers: PassengerSummary[], period: PeriodFilter) {
  const cities = passengers
    .filter((passenger) => period === 'ALL' || passenger.travelPeriod === period)
    .map((passenger) => passenger.city.trim())
    .filter(Boolean)

  return Array.from(new Set(cities)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function hasCityInPeriod(
  passengers: PassengerSummary[],
  city: string,
  period: TravelPeriod,
) {
  return passengers.some(
    (passenger) => passenger.city === city && passenger.travelPeriod === period,
  )
}

function cityFontSize(city: string) {
  if (city.length >= 30) return '33pt'
  if (city.length >= 24) return '39pt'
  if (city.length >= 18) return '46pt'
  return '56pt'
}

function fileSafe(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function CityOrganizationSignsPage() {
  const [passengers, setPassengers] = useState<PassengerSummary[]>([])
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('FIRST_WEEK')
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true

    void listPassengers()
      .then((items) => {
        if (!active) return
        setPassengers(items)
        setSelectedCities(new Set(citiesForPeriod(items, 'FIRST_WEEK')))
      })
      .catch((error) => {
        if (!active) return
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível carregar as cidades cadastradas.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const availableCities = useMemo(
    () => citiesForPeriod(passengers, periodFilter),
    [passengers, periodFilter],
  )

  const signItems = useMemo<SignItem[]>(() => {
    const cities = availableCities.filter((city) => selectedCities.has(city))

    if (periodFilter !== 'ALL') {
      return cities.map((city) => ({ city, period: periodFilter }))
    }

    const items: SignItem[] = []
    for (const period of PERIOD_ORDER) {
      for (const city of cities) {
        if (hasCityInPeriod(passengers, city, period)) {
          items.push({ city, period })
        }
      }
    }
    return items
  }, [availableCities, passengers, periodFilter, selectedCities])

  function changePeriod(nextPeriod: PeriodFilter) {
    setPeriodFilter(nextPeriod)
    setSelectedCities(new Set(citiesForPeriod(passengers, nextPeriod)))
  }

  function toggleCity(city: string) {
    setSelectedCities((current) => {
      const next = new Set(current)
      if (next.has(city)) next.delete(city)
      else next.add(city)
      return next
    })
  }

  function selectAll() {
    setSelectedCities(new Set(availableCities))
  }

  function clearAll() {
    setSelectedCities(new Set())
  }

  function handlePrint() {
    if (signItems.length === 0) return

    const previousTitle = document.title
    const nativeAndroid = isNativeAndroidPrint()
    const periodName = periodFilter === 'ALL'
      ? 'Todos_Periodos'
      : fileSafe(TRAVEL_PERIOD_LABELS[periodFilter])
    const jobName = `Placas_Cidades_Barretao_${periodName}`

    let restored = false
    let focusTimer: number | undefined

    const restore = () => {
      if (restored) return
      restored = true
      document.title = previousTitle
      document.body.classList.remove('printing-city-organization-signs')
      window.removeEventListener('afterprint', restore)
      window.removeEventListener('focus', handleFocus)
      if (focusTimer !== undefined) window.clearTimeout(focusTimer)
    }

    const handleFocus = () => {
      if (!nativeAndroid) return
      focusTimer = window.setTimeout(restore, 300)
    }

    document.title = jobName
    document.body.classList.add('printing-city-organization-signs')

    if (nativeAndroid) window.addEventListener('focus', handleFocus)
    else window.addEventListener('afterprint', restore)

    window.setTimeout(() => {
      void printCurrentDocument(jobName).catch((error) => {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível abrir a impressão das placas.',
        )
        restore()
      })
    }, 140)

    if (nativeAndroid) window.setTimeout(restore, 120_000)
  }

  const allSelected = availableCities.length > 0
    && availableCities.every((city) => selectedCities.has(city))

  return (
    <div className="city-signs-page">
      <style>{`
        .city-signs-page {
          display: grid;
          gap: 20px;
        }

        .city-signs-card {
          padding: 18px;
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          background: var(--surface);
          box-shadow: var(--shadow-sm);
        }

        .city-signs-intro {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .city-signs-intro > svg {
          width: 28px;
          height: 28px;
          flex: 0 0 auto;
          color: var(--navy-700);
        }

        .city-signs-intro h2 {
          margin: 3px 0 6px;
          font-size: clamp(1.35rem, 5vw, 1.85rem);
        }

        .city-signs-intro p:last-child {
          margin: 0;
          color: var(--ink-700);
          font-size: 0.86rem;
          line-height: 1.5;
        }

        .city-signs-filter-grid {
          display: grid;
          gap: 13px;
          margin-top: 18px;
        }

        .city-signs-periods {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .city-sign-period-button {
          min-height: 44px;
          padding: 9px 10px;
          border: 1px solid var(--line);
          border-radius: 12px;
          color: var(--ink-700);
          background: #fff;
          font: inherit;
          font-size: 0.78rem;
          font-weight: 850;
        }

        .city-sign-period-button.is-active {
          border-color: var(--navy-700);
          color: #fff;
          background: var(--navy-900);
        }

        .city-signs-selection-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .city-signs-selection-head strong,
        .city-signs-selection-head span {
          display: block;
        }

        .city-signs-selection-head span {
          margin-top: 2px;
          color: var(--ink-500);
          font-size: 0.75rem;
        }

        .city-signs-mini-actions {
          display: flex;
          gap: 8px;
        }

        .city-signs-mini-actions button {
          border: 0;
          padding: 7px 9px;
          color: var(--blue-600);
          background: transparent;
          font: inherit;
          font-size: 0.74rem;
          font-weight: 850;
        }

        .city-signs-city-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .city-sign-city-button {
          display: flex;
          min-height: 48px;
          align-items: center;
          gap: 8px;
          padding: 9px 10px;
          border: 1px solid var(--line);
          border-radius: 12px;
          color: var(--ink-700);
          background: #fff;
          text-align: left;
          font: inherit;
          font-size: 0.76rem;
          font-weight: 800;
        }

        .city-sign-city-button.is-selected {
          border-color: #a8cfe9;
          color: var(--navy-900);
          background: var(--blue-100);
        }

        .city-sign-city-button svg {
          width: 17px;
          height: 17px;
          flex: 0 0 auto;
        }

        .city-signs-action-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 16px;
          padding-top: 15px;
          border-top: 1px solid var(--line);
        }

        .city-signs-action-bar p {
          margin: 0;
          color: var(--ink-700);
          font-size: 0.8rem;
        }

        .city-signs-action-bar strong {
          color: var(--navy-900);
        }

        .city-signs-preview-grid {
          display: grid;
          gap: 12px;
        }

        .city-sign-preview {
          position: relative;
          display: grid;
          min-height: 260px;
          overflow: hidden;
          place-items: center;
          padding: 20px;
          border: 1px solid #cbd5df;
          border-radius: 18px;
          background:
            linear-gradient(145deg, rgba(13, 34, 54, 0.03), transparent 40%),
            #fff;
          text-align: center;
        }

        .city-sign-preview img {
          width: min(180px, 58vw);
          max-height: 125px;
          object-fit: contain;
        }

        .city-sign-preview__week {
          margin-top: 10px;
          color: var(--red-700);
          font-size: 0.82rem;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .city-sign-preview h3 {
          margin: 8px 0 0;
          color: var(--navy-950);
          font-size: clamp(1.6rem, 8vw, 2.7rem);
          line-height: 0.98;
          text-transform: uppercase;
        }

        .city-sign-preview small {
          margin-top: 10px;
          color: var(--ink-500);
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .city-signs-print-root {
          display: none;
        }

        .city-signs-empty,
        .city-signs-error {
          padding: 14px;
          border-radius: 12px;
          font-size: 0.82rem;
        }

        .city-signs-empty {
          color: var(--ink-700);
          background: #f5f7f9;
        }

        .city-signs-error {
          color: var(--red-700);
          background: var(--red-100);
        }

        @media (min-width: 720px) {
          .city-signs-periods {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .city-signs-city-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .city-signs-preview-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }

          body.printing-city-organization-signs {
            margin: 0 !important;
            background: #fff !important;
          }

          body.printing-city-organization-signs .app-header,
          body.printing-city-organization-signs .bottom-navigation,
          body.printing-city-organization-signs .city-signs-page > :not(.city-signs-print-root) {
            display: none !important;
          }

          body.printing-city-organization-signs .app-shell,
          body.printing-city-organization-signs .app-main,
          body.printing-city-organization-signs .city-signs-page {
            width: auto !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          body.printing-city-organization-signs .city-signs-print-root {
            display: block !important;
            width: 210mm;
            margin: 0;
            padding: 0;
          }

          body.printing-city-organization-signs .city-organization-sign {
            position: relative;
            display: flex !important;
            width: 210mm;
            height: 297mm;
            overflow: hidden;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 16mm 14mm 14mm;
            break-after: page;
            page-break-after: always;
            color: #0d2236;
            background: #fff;
            text-align: center;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          body.printing-city-organization-signs .city-organization-sign:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          body.printing-city-organization-signs .city-organization-sign::before {
            position: absolute;
            inset: 8mm;
            border: 2.2mm solid #0d2236;
            border-radius: 7mm;
            content: '';
          }

          body.printing-city-organization-signs .city-organization-sign::after {
            position: absolute;
            inset: 12mm;
            border: 0.7mm solid #c89b47;
            border-radius: 5mm;
            content: '';
          }

          body.printing-city-organization-signs .city-organization-sign__content {
            position: relative;
            z-index: 1;
            display: flex;
            width: 100%;
            height: 100%;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }

          body.printing-city-organization-signs .city-organization-sign__logo {
            width: 138mm;
            max-height: 92mm;
            object-fit: contain;
          }

          body.printing-city-organization-signs .city-organization-sign__separator {
            width: 112mm;
            height: 1.4mm;
            margin: 7mm 0 5mm;
            border-radius: 999px;
            background: #c89b47;
          }

          body.printing-city-organization-signs .city-organization-sign__week {
            padding: 3mm 9mm;
            border: 1.1mm solid #9e292d;
            border-radius: 999px;
            color: #9e292d;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 25pt;
            font-weight: 900;
            letter-spacing: 0.08em;
            line-height: 1;
            text-transform: uppercase;
          }

          body.printing-city-organization-signs .city-organization-sign h1 {
            max-width: 170mm;
            margin: 9mm 0 0;
            color: #0d2236;
            font-family: Arial, Helvetica, sans-serif;
            font-weight: 950;
            letter-spacing: -0.025em;
            line-height: 0.94;
            text-transform: uppercase;
          }

          body.printing-city-organization-signs .city-organization-sign__footer {
            position: absolute;
            bottom: 20mm;
            color: #425466;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10pt;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
        }
      `}</style>

      <section className="city-signs-card">
        <div className="city-signs-intro">
          <MapPinned aria-hidden="true" />
          <div>
            <p className="eyebrow">Organização física</p>
            <h2>Placas por cidade</h2>
            <p>
              Gere placas A4 grandes para separar as bagagens no galpão por cidade e período.
              Cada cidade e semana ocupa uma folha inteira no PDF.
            </p>
          </div>
        </div>

        {errorMessage ? <div className="city-signs-error">{errorMessage}</div> : null}

        <div className="city-signs-filter-grid">
          <div>
            <p className="eyebrow">Semana / período</p>
            <div className="city-signs-periods">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`city-sign-period-button ${periodFilter === option.value ? 'is-active' : ''}`}
                  onClick={() => changePeriod(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="city-signs-selection-head">
            <div>
              <strong>Cidades cadastradas</strong>
              <span>
                {selectedCities.size} selecionada(s) · {signItems.length} folha(s) A4
              </span>
            </div>
            <div className="city-signs-mini-actions">
              <button type="button" onClick={selectAll} disabled={allSelected}>Selecionar todas</button>
              <button type="button" onClick={clearAll} disabled={selectedCities.size === 0}>Limpar</button>
            </div>
          </div>

          {loading ? (
            <div className="city-signs-empty">
              <LoaderCircle className="spin" aria-hidden="true" /> Carregando cidades...
            </div>
          ) : availableCities.length === 0 ? (
            <div className="city-signs-empty">
              Nenhuma cidade encontrada para este período.
            </div>
          ) : (
            <div className="city-signs-city-grid">
              {availableCities.map((city) => {
                const selected = selectedCities.has(city)
                return (
                  <button
                    key={city}
                    type="button"
                    className={`city-sign-city-button ${selected ? 'is-selected' : ''}`}
                    onClick={() => toggleCity(city)}
                  >
                    {selected ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
                    <span>{city}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="city-signs-action-bar">
          <p>
            <strong>{signItems.length}</strong> página(s) prontas para imprimir ou salvar em PDF.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={handlePrint}
            disabled={signItems.length === 0}
          >
            <Printer aria-hidden="true" />
            Imprimir / Salvar PDF
          </button>
        </div>
      </section>

      {signItems.length > 0 ? (
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Prévia</p>
              <h2>Como as placas ficarão</h2>
            </div>
          </div>
          <div className="city-signs-preview-grid">
            {signItems.slice(0, 6).map((item) => (
              <article className="city-sign-preview" key={`${item.period}-${item.city}`}>
                <img src="/logo.png" alt="Bagagens Barretão" />
                <div>
                  <div className="city-sign-preview__week">
                    {TRAVEL_PERIOD_LABELS[item.period]}
                  </div>
                  <h3>{item.city}</h3>
                  <small>Caravana Flávio Gonçalves</small>
                </div>
              </article>
            ))}
          </div>
          {signItems.length > 6 ? (
            <div className="city-signs-empty" style={{ marginTop: 10 }}>
              A prévia mostra as 6 primeiras. O PDF terá todas as {signItems.length} páginas selecionadas.
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="safety-note">
        <Layers3 aria-hidden="true" />
        <div>
          <strong>Uma placa por folha</strong>
          <p>
            A impressão usa A4 retrato com quebra obrigatória. Cidade e período nunca dividem a mesma página.
          </p>
        </div>
      </section>

      <div className="city-signs-print-root" aria-hidden="true">
        {signItems.map((item) => (
          <section
            className="city-organization-sign"
            key={`print-${item.period}-${item.city}`}
          >
            <div className="city-organization-sign__content">
              <img
                className="city-organization-sign__logo"
                src="/logo.png"
                alt=""
              />
              <div className="city-organization-sign__separator" />
              <div className="city-organization-sign__week">
                {TRAVEL_PERIOD_LABELS[item.period]}
              </div>
              <h1 style={{ fontSize: cityFontSize(item.city) }}>{item.city}</h1>
              <div className="city-organization-sign__footer">
                Caravana Flávio Gonçalves · Barretão 2026
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
