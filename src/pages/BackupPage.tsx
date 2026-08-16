import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileClock,
  Image,
  LoaderCircle,
  RefreshCcw,
  ShieldCheck,
  Upload,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createBackup,
  downloadBackup,
  getBackupOverview,
  inspectBackup,
  restoreBackup,
  shareBackup,
  type BackupInspection,
  type BackupOverview,
} from '../data/backupService'

function formatDateTime(value?: string) {
  if (!value) return 'Ainda não'
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  )
  const result = value / 1024 ** index
  return `${result.toLocaleString('pt-BR', {
    maximumFractionDigits: index === 0 ? 0 : 1,
  })} ${units[index]}`
}

export function BackupPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [overview, setOverview] = useState<BackupOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [generatedFile, setGeneratedFile] = useState<File | null>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [restoreFinished, setRestoreFinished] = useState(false)

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage('')
      setOverview(await getBackupOverview())
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível consultar o estado do backup.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadOverview()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadOverview])

  const estimatedRawSize = useMemo(() => {
    if (!overview) return 0
    return overview.photoBytes
  }, [overview])

  const handleCreate = async () => {
    try {
      setCreating(true)
      setErrorMessage('')
      setSuccessMessage('')
      const result = await createBackup()
      setGeneratedFile(result.file)
      downloadBackup(result.file)
      setSuccessMessage(
        `Backup criado com ${result.inspection.passengerCount} passageiros, ${result.inspection.luggageCount} volumes e ${result.inspection.photoCount} fotos.`,
      )
      await loadOverview()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível criar o backup.',
      )
    } finally {
      setCreating(false)
    }
  }

  const handleShare = async () => {
    if (!generatedFile) return
    try {
      setErrorMessage('')
      const shared = await shareBackup(generatedFile)
      if (!shared) {
        setSuccessMessage(
          'O compartilhamento direto não está disponível neste aparelho. Use “Baixar novamente” e copie o arquivo para outro local.',
        )
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível compartilhar o backup.',
      )
    }
  }

  const handleSelectedFile = async (file?: File) => {
    if (!file) return
    try {
      setInspecting(true)
      setErrorMessage('')
      setSuccessMessage('')
      setRestoreFinished(false)
      setRestoreConfirmed(false)
      setRestoreFile(file)
      setInspection(await inspectBackup(file))
    } catch (error) {
      setRestoreFile(null)
      setInspection(null)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível analisar este backup.',
      )
    } finally {
      setInspecting(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleRestore = async () => {
    if (!restoreFile || !inspection || !restoreConfirmed) return

    try {
      setRestoring(true)
      setErrorMessage('')
      setSuccessMessage('')
      const restored = await restoreBackup(restoreFile)
      setOverview({
        passengerCount: restored.passengerCount,
        luggageCount: restored.luggageCount,
        movementCount: restored.movementCount,
        photoCount: restored.photoCount,
        photoBytes: restored.photoBytes,
        unidentifiedCount: restored.unidentifiedCount,
        setReconciliationCount: restored.setReconciliationCount,
        closureCount: restored.closureCount,
        cityTransferCount: restored.cityTransferCount,
        lastBackupAt: restored.lastBackupAt,
        lastRestoreAt: restored.lastRestoreAt,
      })
      setRestoreFinished(true)
      setSuccessMessage(
        `Restauração concluída: ${restored.passengerCount} passageiros, ${restored.luggageCount} volumes e ${restored.photoCount} fotos recuperados.`,
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível restaurar o backup.',
      )
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="backup-page">
      <style>{`
        .backup-page {
          display: grid;
          gap: 18px;
        }

        .backup-hero,
        .backup-card,
        .backup-inspection {
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          background: var(--surface);
          box-shadow: var(--shadow-sm);
        }

        .backup-hero {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 18px;
        }

        .backup-hero h2,
        .backup-card h2 {
          margin: 3px 0 5px;
          color: var(--navy-950);
        }

        .backup-hero p,
        .backup-card p {
          margin: 0;
          color: var(--ink-700);
          line-height: 1.5;
        }

        .backup-hero__badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 10px;
          border-radius: 999px;
          color: #075985;
          background: #e0f2fe;
          font-size: 0.76rem;
          font-weight: 900;
        }

        .backup-overview-grid,
        .backup-preview-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .backup-overview-item,
        .backup-preview-item {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
        }

        .backup-overview-item svg,
        .backup-preview-item svg {
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
          color: var(--navy-700);
        }

        .backup-overview-item span,
        .backup-overview-item strong,
        .backup-preview-item span,
        .backup-preview-item strong {
          display: block;
        }

        .backup-overview-item span,
        .backup-preview-item span {
          color: var(--ink-500);
          font-size: 0.69rem;
          font-weight: 800;
          text-transform: uppercase;
        }

        .backup-overview-item strong,
        .backup-preview-item strong {
          margin-top: 2px;
          color: var(--navy-950);
          font-size: 1rem;
        }

        .backup-card {
          display: grid;
          gap: 14px;
          padding: 17px;
        }

        .backup-card__heading {
          display: flex;
          align-items: flex-start;
          gap: 11px;
        }

        .backup-card__heading > svg {
          width: 25px;
          height: 25px;
          flex: 0 0 auto;
          color: var(--navy-700);
        }

        .backup-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }

        .backup-file-note {
          padding: 10px 11px;
          border-radius: 10px;
          color: var(--ink-700);
          background: #f5f7f9;
          font-size: 0.76rem;
          line-height: 1.45;
        }

        .backup-inspection {
          display: grid;
          gap: 13px;
          padding: 15px;
          border-color: #bfd7e8;
          background: #f8fcff;
        }

        .backup-inspection__header {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 9px;
        }

        .backup-inspection__header strong {
          display: block;
          color: var(--navy-950);
        }

        .backup-inspection__header span {
          display: block;
          margin-top: 3px;
          color: var(--ink-500);
          font-size: 0.75rem;
        }

        .backup-warning-box {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 11px;
          border: 1px solid #f5c96b;
          border-radius: 11px;
          color: #713f12;
          background: #fff8e8;
          font-size: 0.78rem;
          line-height: 1.45;
        }

        .backup-warning-box svg {
          width: 20px;
          height: 20px;
          flex: 0 0 auto;
        }

        .backup-confirm {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 11px;
          border-radius: 11px;
          background: #fff;
          font-size: 0.79rem;
          font-weight: 800;
          line-height: 1.4;
        }

        .backup-confirm input {
          width: 19px;
          height: 19px;
          margin-top: 1px;
          flex: 0 0 auto;
        }

        .backup-success {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 12px;
          border: 1px solid #a7dfbd;
          border-radius: 11px;
          color: #166534;
          background: #f0fdf4;
        }

        .backup-success svg {
          width: 21px;
          height: 21px;
          flex: 0 0 auto;
        }

        .backup-danger-button {
          display: inline-flex;
          min-height: 43px;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 0 14px;
          border: 0;
          border-radius: 11px;
          color: #fff;
          background: #b42318;
          font: inherit;
          font-size: 0.8rem;
          font-weight: 900;
          cursor: pointer;
        }

        .backup-danger-button:disabled {
          cursor: not-allowed;
          opacity: 0.48;
        }

        @media (min-width: 760px) {
          .backup-overview-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .backup-preview-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
      `}</style>

      <section className="backup-hero">
        <div>
          <p className="eyebrow">Segurança da operação</p>
          <h2>Backup e restauração</h2>
          <p>
            Gere uma cópia completa do banco local, incluindo fotografias, movimentações,
            achados e conferências dos conjuntos. A restauração só acontece depois da análise e confirmação.
          </p>
        </div>
        <span className="backup-hero__badge">
          <ShieldCheck aria-hidden="true" />
          Funciona offline
        </span>
      </section>

      {errorMessage ? <div className="alert alert--danger">{errorMessage}</div> : null}
      {successMessage ? (
        <div className="backup-success">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>Operação concluída</strong>
            <p>{successMessage}</p>
          </div>
        </div>
      ) : null}

      {loading || !overview ? (
        <div className="loading-state">
          <LoaderCircle className="spin" aria-hidden="true" />
          Conferindo banco local...
        </div>
      ) : (
        <>
          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Conteúdo protegido</p>
                <h2>Estado atual do banco</h2>
              </div>
              <button type="button" className="secondary-button" onClick={() => void loadOverview()}>
                <RefreshCcw aria-hidden="true" />
                Atualizar
              </button>
            </div>

            <div className="backup-overview-grid">
              <OverviewItem icon={<UsersRound />} label="Passageiros" value={String(overview.passengerCount)} />
              <OverviewItem icon={<Boxes />} label="Volumes" value={String(overview.luggageCount)} />
              <OverviewItem icon={<Image />} label="Fotos" value={`${overview.photoCount} · ${formatBytes(overview.photoBytes)}`} />
              <OverviewItem icon={<FileClock />} label="Movimentações" value={String(overview.movementCount)} />
              <OverviewItem icon={<AlertTriangle />} label="Achados abertos" value={String(overview.unidentifiedCount)} />
              <OverviewItem icon={<Database />} label="Reconciliações" value={String(overview.setReconciliationCount)} />
              <OverviewItem icon={<Cloud />} label="Último backup" value={formatDateTime(overview.lastBackupAt)} />
              <OverviewItem icon={<ShieldCheck />} label="Última restauração" value={formatDateTime(overview.lastRestoreAt)} />
            </div>
          </section>

          <section className="backup-card">
            <div className="backup-card__heading">
              <Download aria-hidden="true" />
              <div>
                <p className="eyebrow">Cópia de segurança</p>
                <h2>Criar backup completo</h2>
                <p>
                  O arquivo reúne toda a base atual. As fotografias representam a maior parte do tamanho
                  e são compactadas automaticamente quando o navegador permitir.
                </p>
              </div>
            </div>

            <div className="backup-file-note">
              Fotografias armazenadas: {formatBytes(estimatedRawSize)}. O tamanho final do arquivo pode ser menor
              por causa da compactação.
            </div>

            <div className="backup-actions">
              <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={creating}>
                {creating ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                {creating ? 'Criando backup...' : 'Criar e baixar backup'}
              </button>

              {generatedFile ? (
                <>
                  <button type="button" className="secondary-button" onClick={() => downloadBackup(generatedFile)}>
                    <Download aria-hidden="true" />
                    Baixar novamente
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void handleShare()}>
                    <Cloud aria-hidden="true" />
                    Compartilhar / salvar cópia
                  </button>
                </>
              ) : null}
            </div>

            {generatedFile ? (
              <div className="backup-file-note">
                Arquivo atual: <strong>{generatedFile.name}</strong> · {formatBytes(generatedFile.size)}
              </div>
            ) : null}
          </section>

          <section className="backup-card">
            <div className="backup-card__heading">
              <Upload aria-hidden="true" />
              <div>
                <p className="eyebrow">Recuperação</p>
                <h2>Restaurar um backup</h2>
                <p>
                  Primeiro o aplicativo analisa o arquivo. Nenhum dado é alterado apenas por selecionar um backup.
                </p>
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".barretaobackup,application/gzip,application/json"
              onChange={(event) => void handleSelectedFile(event.target.files?.[0])}
            />

            <div className="backup-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => inputRef.current?.click()}
                disabled={inspecting || restoring}
              >
                {inspecting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                {inspecting ? 'Analisando...' : 'Selecionar e analisar backup'}
              </button>
            </div>

            {inspection && restoreFile ? (
              <div className="backup-inspection">
                <div className="backup-inspection__header">
                  <div>
                    <strong>{inspection.fileName}</strong>
                    <span>
                      Criado em {formatDateTime(inspection.createdAt)} · {formatBytes(inspection.fileSizeBytes)}
                    </span>
                  </div>
                  <span>Banco v{inspection.databaseVersion} · formato v{inspection.formatVersion}</span>
                </div>

                <div className="backup-preview-grid">
                  <OverviewItem icon={<UsersRound />} label="Passageiros" value={String(inspection.passengerCount)} />
                  <OverviewItem icon={<Boxes />} label="Volumes" value={String(inspection.luggageCount)} />
                  <OverviewItem icon={<Image />} label="Fotos" value={String(inspection.photoCount)} />
                  <OverviewItem icon={<FileClock />} label="Movimentações" value={String(inspection.movementCount)} />
                  <OverviewItem icon={<AlertTriangle />} label="Achados abertos" value={String(inspection.unidentifiedCount)} />
                  <OverviewItem icon={<Database />} label="Reconciliações" value={String(inspection.setReconciliationCount)} />
                  <OverviewItem icon={<Cloud />} label="Fechamentos" value={String(inspection.closureCount)} />
                  <OverviewItem icon={<ShieldCheck />} label="Transf. cidades" value={String(inspection.cityTransferCount)} />
                </div>

                {inspection.warnings.length > 0 ? (
                  <div className="backup-warning-box">
                    <AlertTriangle aria-hidden="true" />
                    <div>
                      <strong>Atenção durante a análise</strong>
                      {inspection.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  </div>
                ) : (
                  <div className="backup-success">
                    <CheckCircle2 aria-hidden="true" />
                    <div>
                      <strong>Estrutura validada</strong>
                      <p>O arquivo possui as tabelas essenciais e as referências principais estão consistentes.</p>
                    </div>
                  </div>
                )}

                <div className="backup-warning-box">
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <strong>Esta ação substitui o banco atual deste aparelho.</strong>
                    <p>
                      Passageiros, bagagens, fotos e históricos que existirem aqui serão trocados pelo conteúdo
                      mostrado acima. Faça um backup do aparelho atual antes se houver algo que precise preservar.
                    </p>
                  </div>
                </div>

                <label className="backup-confirm">
                  <input
                    type="checkbox"
                    checked={restoreConfirmed}
                    onChange={(event) => setRestoreConfirmed(event.target.checked)}
                    disabled={restoring || restoreFinished}
                  />
                  Entendo que a restauração substituirá todos os dados locais deste aparelho pelo conteúdo do arquivo analisado.
                </label>

                <div className="backup-actions">
                  <button
                    type="button"
                    className="backup-danger-button"
                    disabled={!restoreConfirmed || restoring || restoreFinished}
                    onClick={() => void handleRestore()}
                  >
                    {restoring ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                    {restoring ? 'Restaurando...' : 'Restaurar este backup'}
                  </button>

                  {restoreFinished ? (
                    <button type="button" className="primary-button" onClick={() => window.location.assign('/')}>
                      <CheckCircle2 aria-hidden="true" />
                      Voltar ao painel
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="safety-note">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>Tenha duas cópias em lugares diferentes</strong>
              <p>
                No dia da viagem, mantenha uma cópia no celular principal e outra no aparelho reserva ou em um
                serviço de arquivos. O backup não depende de internet para ser criado ou restaurado.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function OverviewItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <article className="backup-overview-item">
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  )
}
