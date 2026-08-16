import {
  AlertTriangle,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  ImageOff,
  LoaderCircle,
  MapPin,
  PackageOpen,
  Search,
  Trash2,
  UserRoundCheck,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Modal } from '../components/Modal'
import { PhotoCaptureButtons } from '../components/PhotoCaptureButtons'
import { STAGE_LABELS } from '../constants/operations'
import {
  createUnidentifiedLuggage,
  deleteUnidentifiedLuggage,
  getPhotosByIds,
  listPassengers,
  listUnidentifiedLuggage,
  resolveUnidentifiedLuggage,
} from '../data/repository'
import type {
  LuggageStage,
  PassengerSummary,
  PhotoRecord,
  UnidentifiedLuggage,
  UnidentifiedLuggageLocation,
} from '../domain/types'
import { compressPhoto } from '../utils/imageCompression'

const LOCATION_LABELS: Record<UnidentifiedLuggageLocation, string> = {
  WAREHOUSE_INITIAL: 'Galpão de saída',
  TRAILER_OUTBOUND: 'Carreta / viagem de ida',
  BARRETOS: 'Barretos / camping',
  TRAILER_RETURN: 'Carreta / viagem de retorno',
  WAREHOUSE_RETURN: 'Galpão de retorno',
}

const STAGE_OPTIONS: LuggageStage[] = [
  'WAREHOUSE_INITIAL',
  'TRAILER_OUTBOUND',
  'WITH_PASSENGER',
  'TRAILER_RETURN',
  'WAREHOUSE_RETURN',
  'DELIVERED_TO_CITY',
]

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleUpperCase('pt-BR')
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function defaultStageForLocation(location: UnidentifiedLuggageLocation): LuggageStage {
  if (location === 'WAREHOUSE_INITIAL') return 'WAREHOUSE_INITIAL'
  if (location === 'TRAILER_OUTBOUND') return 'TRAILER_OUTBOUND'
  if (location === 'BARRETOS') return 'WITH_PASSENGER'
  if (location === 'TRAILER_RETURN') return 'TRAILER_RETURN'
  return 'WAREHOUSE_RETURN'
}

export function UnidentifiedLuggagePage() {
  const [records, setRecords] = useState<UnidentifiedLuggage[]>([])
  const [passengers, setPassengers] = useState<PassengerSummary[]>([])
  const [photos, setPhotos] = useState<Record<string, PhotoRecord>>({})
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const [quantity, setQuantity] = useState(1)
  const [foundLocation, setFoundLocation] = useState<UnidentifiedLuggageLocation>('WAREHOUSE_INITIAL')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const [resolveTarget, setResolveTarget] = useState<UnidentifiedLuggage | null>(null)
  const [passengerQuery, setPassengerQuery] = useState('')
  const [selectedPassengerId, setSelectedPassengerId] = useState('')
  const [resolveStage, setResolveStage] = useState<LuggageStage>('WAREHOUSE_INITIAL')
  const [resolving, setResolving] = useState(false)

  const [photoViewer, setPhotoViewer] = useState<{ title: string; url: string } | null>(null)

  const loadPage = useCallback(async () => {
    try {
      setLoading(true)
      setPageError('')
      const [loadedRecords, loadedPassengers] = await Promise.all([
        listUnidentifiedLuggage(true),
        listPassengers(),
      ])
      const photoIds = Array.from(new Set(loadedRecords.map((record) => record.photoId).filter(Boolean)))
      const loadedPhotos = await getPhotosByIds(photoIds)
      setRecords(loadedRecords)
      setPassengers(loadedPassengers)
      setPhotos(Object.fromEntries(loadedPhotos.map((photo) => [photo.id, photo])))
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar as bagagens sem identificação.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPage()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadPage])

  const photoUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    for (const photo of Object.values(photos)) {
      urls[photo.id] = URL.createObjectURL(photo.blob)
    }
    return urls
  }, [photos])

  useEffect(() => {
    return () => {
      Object.values(photoUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [photoUrls])

  const pendingPreviewUrl = useMemo(
    () => (photoFile ? URL.createObjectURL(photoFile) : ''),
    [photoFile],
  )

  useEffect(() => {
    if (!pendingPreviewUrl) return
    return () => URL.revokeObjectURL(pendingPreviewUrl)
  }, [pendingPreviewUrl])

  const openRecords = useMemo(
    () => records.filter((record) => record.status === 'OPEN'),
    [records],
  )

  const resolvedRecords = useMemo(
    () => records.filter((record) => record.status === 'RESOLVED'),
    [records],
  )

  const openVolumeCount = useMemo(
    () => openRecords.reduce((total, record) => total + record.quantity, 0),
    [openRecords],
  )

  const resolvedPassengerNames = useMemo(
    () => new Map(passengers.map((passenger) => [passenger.id, passenger.fullName])),
    [passengers],
  )

  const filteredPassengers = useMemo(() => {
    const normalized = normalizeSearch(passengerQuery)
    if (!normalized) return passengers.slice(0, 30)
    return passengers
      .filter((passenger) => passenger.normalizedName.includes(normalized))
      .slice(0, 30)
  }, [passengerQuery, passengers])

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!photoFile) {
      setPageError('Tire ou escolha uma foto antes de salvar o achado.')
      return
    }

    try {
      setSaving(true)
      setPageError('')
      const compressed = await compressPhoto(photoFile)
      await createUnidentifiedLuggage({
        quantity,
        foundLocation,
        description,
        notes,
        photo: compressed,
      })

      setQuantity(1)
      setDescription('')
      setNotes('')
      setPhotoFile(null)
      await loadPage()
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o volume sem identificação.',
      )
    } finally {
      setSaving(false)
    }
  }

  const openResolve = (record: UnidentifiedLuggage) => {
    setResolveTarget(record)
    setPassengerQuery('')
    setSelectedPassengerId('')
    setResolveStage(defaultStageForLocation(record.foundLocation))
    setPageError('')
  }

  const handleResolve = async () => {
    if (!resolveTarget || !selectedPassengerId) return

    try {
      setResolving(true)
      setPageError('')
      await resolveUnidentifiedLuggage(resolveTarget.id, {
        passengerId: selectedPassengerId,
        currentStage: resolveStage,
      })
      setResolveTarget(null)
      setSelectedPassengerId('')
      setPassengerQuery('')
      await loadPage()
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível vincular o achado ao passageiro.',
      )
    } finally {
      setResolving(false)
    }
  }

  const handleDelete = async (record: UnidentifiedLuggage) => {
    const confirmed = window.confirm(
      `Excluir definitivamente este achado de ${record.quantity} ${record.quantity === 1 ? 'volume' : 'volumes'}?`,
    )
    if (!confirmed) return

    try {
      setPageError('')
      await deleteUnidentifiedLuggage(record.id)
      await loadPage()
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir este achado.',
      )
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" aria-hidden="true" />
        Carregando achados...
      </div>
    )
  }

  return (
    <div className="unidentified-page">
      <style>{`
        .unidentified-page {
          display: grid;
          gap: 18px;
        }

        .unidentified-hero,
        .unidentified-form-card,
        .unidentified-record,
        .unidentified-history {
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          background: var(--surface);
          box-shadow: var(--shadow-sm);
        }

        .unidentified-hero {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px;
        }

        .unidentified-hero h2 {
          margin: 3px 0 6px;
        }

        .unidentified-hero p:last-child {
          margin: 0;
          max-width: 720px;
          color: var(--ink-700);
          line-height: 1.5;
        }

        .unidentified-count {
          display: grid;
          min-width: 120px;
          place-items: center;
          padding: 14px;
          border-radius: 14px;
          background: #fff4df;
          color: #7a4a00;
        }

        .unidentified-count strong {
          font-size: 2rem;
          line-height: 1;
        }

        .unidentified-count span {
          margin-top: 4px;
          font-size: .72rem;
          font-weight: 900;
          text-transform: uppercase;
        }

        .unidentified-form-card {
          display: grid;
          gap: 14px;
          padding: 16px;
        }

        .unidentified-form-grid {
          display: grid;
          gap: 12px;
        }

        .unidentified-quantity {
          display: grid;
          grid-template-columns: auto minmax(90px, 1fr) auto;
          align-items: end;
          gap: 8px;
        }

        .unidentified-quantity > button {
          min-width: 48px;
          min-height: 46px;
        }

        .unidentified-photo-preview {
          display: grid;
          min-height: 190px;
          place-items: center;
          overflow: hidden;
          border: 1px dashed var(--line);
          border-radius: 14px;
          background: #eef2f5;
        }

        .unidentified-photo-preview img {
          width: 100%;
          max-height: 360px;
          object-fit: contain;
          background: #111820;
        }

        .unidentified-photo-preview div {
          display: grid;
          place-items: center;
          gap: 8px;
          color: var(--ink-500);
        }

        .unidentified-photo-preview svg {
          width: 42px;
          height: 42px;
        }

        .unidentified-list {
          display: grid;
          gap: 12px;
        }

        .unidentified-record {
          overflow: hidden;
        }

        .unidentified-record__photo {
          display: grid;
          min-height: 190px;
          place-items: center;
          border: 0;
          background: #eef2f5;
          cursor: pointer;
        }

        .unidentified-record__photo img {
          width: 100%;
          max-height: 330px;
          object-fit: contain;
          background: #111820;
        }

        .unidentified-record__body {
          display: grid;
          gap: 10px;
          padding: 15px;
        }

        .unidentified-record__heading {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 10px;
        }

        .unidentified-record__heading h3 {
          margin: 0;
          color: var(--navy-950);
        }

        .unidentified-record__heading p {
          margin: 4px 0 0;
          color: var(--ink-500);
          font-size: .78rem;
        }

        .unidentified-volume-badge {
          align-self: flex-start;
          padding: 7px 9px;
          border-radius: 999px;
          background: #fff4df;
          color: #7a4a00;
          font-size: .75rem;
          font-weight: 900;
        }

        .unidentified-record__notes {
          display: grid;
          gap: 5px;
          color: var(--ink-700);
          font-size: .8rem;
        }

        .unidentified-record__actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .unidentified-history {
          padding: 15px;
        }

        .unidentified-history summary {
          cursor: pointer;
          font-weight: 900;
        }

        .unidentified-resolved-list {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }

        .unidentified-resolved-item {
          display: grid;
          gap: 3px;
          padding: 10px;
          border-radius: 10px;
          background: #f4f7f8;
          font-size: .78rem;
        }

        .unidentified-passenger-search {
          position: sticky;
          top: 0;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
        }

        .unidentified-passenger-search input {
          width: 100%;
          border: 0;
          outline: 0;
          font: inherit;
        }

        .unidentified-passenger-list {
          display: grid;
          gap: 7px;
          max-height: 320px;
          overflow: auto;
          margin-top: 10px;
        }

        .unidentified-passenger-option {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          text-align: left;
        }

        .unidentified-passenger-option.is-selected {
          border-color: var(--blue-500);
          background: var(--blue-50);
        }

        .unidentified-passenger-option div {
          display: grid;
          gap: 2px;
        }

        .unidentified-passenger-option small {
          color: var(--ink-500);
        }

        @media (min-width: 760px) {
          .unidentified-form-grid {
            grid-template-columns: 1fr 1fr;
          }

          .unidentified-list {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>

      <section className="unidentified-hero">
        <div>
          <p className="eyebrow">Achados da operação</p>
          <h2>Bagagens sem identificação</h2>
          <p>
            Fotografe o volume assim que ele aparecer e continue trabalhando.
            Quando o dono for descoberto, vincule o achado ao passageiro sem recadastrar nem perder o horário original.
          </p>
        </div>
        <div className="unidentified-count">
          <strong>{openVolumeCount}</strong>
          <span>{openVolumeCount === 1 ? 'volume aguardando dono' : 'volumes aguardando dono'}</span>
        </div>
      </section>

      {pageError ? <div className="alert alert--danger">{pageError}</div> : null}

      <form className="unidentified-form-card" onSubmit={handleCreate}>
        <div className="form-section-title">
          <Camera aria-hidden="true" />
          <div>
            <strong>Registrar um achado</strong>
            <span>Não precisa saber o nome do passageiro agora.</span>
          </div>
        </div>

        <div className="unidentified-form-grid">
          <div className="unidentified-quantity">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
              disabled={quantity <= 1}
            >
              −
            </button>
            <label className="field">
              <span>Quantidade de volumes *</span>
              <input
                type="number"
                min={1}
                max={99}
                value={quantity}
                onChange={(event) => setQuantity(Math.min(99, Math.max(1, Math.trunc(Number(event.target.value) || 1))))}
                inputMode="numeric"
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setQuantity((current) => Math.min(99, current + 1))}
              disabled={quantity >= 99}
            >
              +
            </button>
          </div>

          <label className="field">
            <span>Encontrado em *</span>
            <select
              value={foundLocation}
              onChange={(event) => setFoundLocation(event.target.value as UnidentifiedLuggageLocation)}
            >
              {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="unidentified-photo-preview">
          {pendingPreviewUrl ? (
            <img src={pendingPreviewUrl} alt="Prévia do achado" />
          ) : (
            <div>
              <ImageOff aria-hidden="true" />
              <strong>Foto obrigatória</strong>
              <span>Fotografe o conjunto como ele foi encontrado.</span>
            </div>
          )}
        </div>

        <PhotoCaptureButtons
          onSelect={setPhotoFile}
          busy={saving}
          cameraLabel={photoFile ? 'Refazer foto' : 'Tirar foto'}
          galleryLabel={photoFile ? 'Trocar da galeria' : 'Escolher da galeria'}
        />

        <div className="unidentified-form-grid">
          <label className="field">
            <span>Descrição visual</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ex.: saco preto grande com fita azul"
            />
          </label>

          <label className="field">
            <span>Observação</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ex.: estava ao lado das caixas da cozinha"
            />
          </label>
        </div>

        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <PackageOpen aria-hidden="true" />}
          Salvar achado e continuar
        </button>
      </form>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Aguardando identificação</p>
            <h2>{openRecords.length} {openRecords.length === 1 ? 'achado em aberto' : 'achados em aberto'}</h2>
          </div>
        </div>

        {openRecords.length === 0 ? (
          <section className="empty-state">
            <CheckCircle2 aria-hidden="true" />
            <h3>Nenhum volume aguardando dono</h3>
            <p>Os achados que forem identificados aparecerão no histórico abaixo.</p>
          </section>
        ) : (
          <div className="unidentified-list">
            {openRecords.map((record) => {
              const photoUrl = photoUrls[record.photoId]
              return (
                <article className="unidentified-record" key={record.id}>
                  <button
                    type="button"
                    className="unidentified-record__photo"
                    onClick={() => photoUrl && setPhotoViewer({
                      title: `Achado de ${formatDateTime(record.foundAt)}`,
                      url: photoUrl,
                    })}
                    disabled={!photoUrl}
                  >
                    {photoUrl ? (
                      <img src={photoUrl} alt="Bagagem sem identificação" />
                    ) : (
                      <ImageOff aria-hidden="true" />
                    )}
                  </button>

                  <div className="unidentified-record__body">
                    <div className="unidentified-record__heading">
                      <div>
                        <h3>{record.description || 'Sem descrição visual'}</h3>
                        <p>
                          <MapPin aria-hidden="true" /> {LOCATION_LABELS[record.foundLocation]} • {formatDateTime(record.foundAt)}
                        </p>
                      </div>
                      <span className="unidentified-volume-badge">
                        {record.quantity} {record.quantity === 1 ? 'volume' : 'volumes'}
                      </span>
                    </div>

                    <div className="unidentified-record__notes">
                      {record.notes ? <span><strong>Observação:</strong> {record.notes}</span> : null}
                      <span><strong>Status:</strong> aguardando identificação do dono.</span>
                    </div>

                    <div className="unidentified-record__actions">
                      <button type="button" className="primary-button" onClick={() => openResolve(record)}>
                        <UserRoundCheck aria-hidden="true" />
                        Vincular a passageiro
                      </button>
                      <button type="button" className="danger-outline-button" onClick={() => void handleDelete(record)}>
                        <Trash2 aria-hidden="true" />
                        Excluir
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {resolvedRecords.length > 0 ? (
        <details className="unidentified-history">
          <summary>Histórico de achados resolvidos ({resolvedRecords.length})</summary>
          <div className="unidentified-resolved-list">
            {resolvedRecords.map((record) => (
              <div className="unidentified-resolved-item" key={record.id}>
                <strong>{record.quantity} {record.quantity === 1 ? 'volume' : 'volumes'} • {record.description || 'Sem descrição'}</strong>
                <span>Encontrado em {LOCATION_LABELS[record.foundLocation]} • {formatDateTime(record.foundAt)}</span>
                <span>
                  Vinculado a {resolvedPassengerNames.get(record.resolvedPassengerId ?? '') ?? 'passageiro não encontrado'}
                  {record.resolvedAt ? ` • ${formatDateTime(record.resolvedAt)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <Modal
        open={Boolean(resolveTarget)}
        title="Vincular achado ao passageiro"
        subtitle={resolveTarget ? `${resolveTarget.quantity} ${resolveTarget.quantity === 1 ? 'volume' : 'volumes'} encontrados em ${LOCATION_LABELS[resolveTarget.foundLocation]}` : undefined}
        onClose={() => {
          if (resolving) return
          setResolveTarget(null)
        }}
        size="large"
      >
        {resolveTarget ? (
          <div className="form-stack">
            <div className="alert alert--warning">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>O registro original será preservado</strong>
                <p>A foto, a descrição e o horário do achado continuam guardados depois do vínculo.</p>
              </div>
            </div>

            <label className="field">
              <span>Onde estes volumes entram no fluxo agora?</span>
              <select value={resolveStage} onChange={(event) => setResolveStage(event.target.value as LuggageStage)}>
                {STAGE_OPTIONS.map((stage) => (
                  <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
                ))}
              </select>
            </label>

            <div>
              <strong>Escolha o passageiro</strong>
              <label className="unidentified-passenger-search">
                <Search aria-hidden="true" />
                <input
                  value={passengerQuery}
                  onChange={(event) => setPassengerQuery(event.target.value)}
                  placeholder="Pesquisar pelo nome"
                  autoFocus
                />
                {passengerQuery ? (
                  <button type="button" onClick={() => setPassengerQuery('')} aria-label="Limpar pesquisa">
                    <X aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              <div className="unidentified-passenger-list">
                {filteredPassengers.map((passenger) => (
                  <button
                    type="button"
                    className={`unidentified-passenger-option ${selectedPassengerId === passenger.id ? 'is-selected' : ''}`}
                    key={passenger.id}
                    onClick={() => setSelectedPassengerId(passenger.id)}
                  >
                    <BriefcaseBusiness aria-hidden="true" />
                    <div>
                      <strong>{passenger.fullName}</strong>
                      <small>{passenger.city} • {passenger.luggageCount} {passenger.luggageCount === 1 ? 'bagagem cadastrada' : 'bagagens cadastradas'}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setResolveTarget(null)} disabled={resolving}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!selectedPassengerId || resolving}
                onClick={() => void handleResolve()}
              >
                {resolving ? <LoaderCircle className="spin" aria-hidden="true" /> : <UserRoundCheck aria-hidden="true" />}
                Vincular {resolveTarget.quantity} {resolveTarget.quantity === 1 ? 'volume' : 'volumes'}
              </button>
            </div>
          </div>
        ) : null}
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
    </div>
  )
}
