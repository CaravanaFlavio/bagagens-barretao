import {
  Barcode,
  BriefcaseBusiness,
  Camera,
  ChevronDown,
  Edit3,
  LoaderCircle,
  MapPin,
  PackagePlus,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { Modal } from '../components/Modal'
import { CITIES, LABEL_COLORS } from '../constants/cities'
import { TRAVEL_PERIOD_LABELS, TRAVEL_PERIOD_OPTIONS } from '../constants/travelPeriods'
import {
  createLuggage,
  deleteLuggagePermanently,
  deletePassengerPermanently,
  listLuggageByPassenger,
  listPassengers,
  savePassenger,
} from '../data/repository'
import type {
  CodeSource,
  Luggage,
  LuggageInput,
  PassengerInput,
  PassengerSummary,
  TravelPeriod,
} from '../domain/types'

const emptyPassengerForm: PassengerInput = {
  fullName: '',
  city: '',
  phone: '',
  travelPeriod: 'FIRST_WEEK',
  notes: '',
}

const emptyLuggageForm: Omit<LuggageInput, 'passengerId'> = {
  code: '',
  codeSource: 'MANUAL',
  labelColor: '',
  luggageType: 'Mala',
  notes: '',
}

export function PassengersPage() {
  const [passengers, setPassengers] = useState<PassengerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [query, setQuery] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState<TravelPeriod | ''>('')

  const [passengerModalOpen, setPassengerModalOpen] = useState(false)
  const [editingPassenger, setEditingPassenger] = useState<PassengerSummary | null>(null)
  const [passengerForm, setPassengerForm] = useState<PassengerInput>(emptyPassengerForm)
  const [passengerFormError, setPassengerFormError] = useState('')
  const [savingPassenger, setSavingPassenger] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<PassengerSummary | null>(null)
  const [deletingPassenger, setDeletingPassenger] = useState(false)

  const [luggagePassenger, setLuggagePassenger] = useState<PassengerSummary | null>(null)
  const [luggage, setLuggage] = useState<Luggage[]>([])
  const [luggageForm, setLuggageForm] = useState(emptyLuggageForm)
  const [luggageFormError, setLuggageFormError] = useState('')
  const [savingLuggage, setSavingLuggage] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const loadPassengers = useCallback(async () => {
    try {
      setPageError('')
      const result = await listPassengers()
      setPassengers(result)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Não foi possível carregar os passageiros.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPassengers()
  }, [loadPassengers])

  const filteredPassengers = useMemo(() => {
    const normalizedQuery = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleUpperCase('pt-BR')

    return passengers.filter((passenger) => {
      const matchesQuery =
        !normalizedQuery ||
        passenger.normalizedName.includes(normalizedQuery) ||
        passenger.phone.replace(/\D/g, '').includes(normalizedQuery.replace(/\D/g, ''))
      const matchesCity = !cityFilter || passenger.city === cityFilter
      const matchesPeriod = !periodFilter || passenger.travelPeriod === periodFilter
      return matchesQuery && matchesCity && matchesPeriod
    })
  }, [cityFilter, passengers, periodFilter, query])

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

  const openLuggage = async (passenger: PassengerSummary) => {
    setLuggagePassenger(passenger)
    setLuggageForm(emptyLuggageForm)
    setLuggageFormError('')
    const result = await listLuggageByPassenger(passenger.id)
    setLuggage(result)
  }

  const refreshLuggage = async () => {
    if (!luggagePassenger) return
    const result = await listLuggageByPassenger(luggagePassenger.id)
    setLuggage(result)
  }

  const handleLuggageSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!luggagePassenger) return

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
      `Excluir definitivamente a bagagem ${item.code} e todo o histórico dela?`,
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

  return (
    <div className="passengers-page">
      <section className="page-title-card">
        <div>
          <p className="eyebrow">Base da operação</p>
          <h2>Passageiros</h2>
          <p>Cadastre as pessoas antes das bagagens chegarem ao galpão.</p>
        </div>
        <button type="button" className="primary-button" onClick={openNewPassenger}>
          <Plus aria-hidden="true" />
          Novo passageiro
        </button>
      </section>

      <section className="filter-card">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar nome ou telefone"
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
            <article className="passenger-card" key={passenger.id}>
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
                  </div>
                </div>
              </div>

              <div className="passenger-card__body">
                <div className="passenger-detail">
                  <Phone aria-hidden="true" />
                  <span>{passenger.phone || 'Telefone não informado'}</span>
                </div>
                <div className="luggage-total">
                  <BriefcaseBusiness aria-hidden="true" />
                  <strong>{passenger.luggageCount}</strong>
                  <span>{passenger.luggageCount === 1 ? 'bagagem cadastrada' : 'bagagens cadastradas'}</span>
                </div>
                {passenger.notes ? <p className="passenger-notes">{passenger.notes}</p> : null}
              </div>

              <div className="passenger-card__actions">
                <button type="button" className="action-button action-button--primary" onClick={() => void openLuggage(passenger)}>
                  <PackagePlus aria-hidden="true" />
                  Incluir bagagem
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
                  Serão excluídas também {deleteTarget.luggageCount} {deleteTarget.luggageCount === 1 ? 'bagagem vinculada' : 'bagagens vinculadas'} e todo o histórico correspondente.
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
        onClose={() => setLuggagePassenger(null)}
        size="large"
      >
        <div className="luggage-layout">
          <form className="luggage-form form-stack" onSubmit={handleLuggageSubmit}>
            <div className="form-section-title">
              <PackagePlus aria-hidden="true" />
              <div>
                <strong>Incluir uma bagagem</strong>
                <span>O primeiro registro já será salvo como recebida no galpão.</span>
              </div>
            </div>

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

            {luggageFormError ? <div className="alert alert--danger">{luggageFormError}</div> : null}

            <button type="submit" className="primary-button" disabled={savingLuggage}>
              {savingLuggage ? <LoaderCircle className="spin" /> : <PackagePlus />}
              Cadastrar bagagem
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
                {luggage.map((item, index) => (
                  <article className="luggage-item" key={item.id}>
                    <div className="luggage-number">{index + 1}</div>
                    <div className="luggage-item__content">
                      <strong>{item.code}</strong>
                      <span>{item.luggageType} • {item.labelColor}</span>
                      <small>Recebida no galpão em {new Date(item.createdAt).toLocaleString('pt-BR')}</small>
                    </div>
                    <button type="button" className="icon-danger-button" onClick={() => void handleDeleteLuggage(item)} aria-label={`Excluir bagagem ${item.code}`}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
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
