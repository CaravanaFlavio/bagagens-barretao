import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  BriefcaseBusiness,
  Building2,
  BusFront,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Cloud,
  CloudOff,
  Database,
  FileClock,
  House,
  MapPinned,
  PackageCheck,
  PackageOpen,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Link, Route, Routes, useLocation } from 'react-router'
import './App.css'

type OperationCardProps = {
  title: string
  description: string
  path: string
  icon: ReactNode
  sequence: string
  tone: 'blue' | 'red' | 'green' | 'amber'
}

type SecondaryActionProps = {
  title: string
  description: string
  path: string
  icon: ReactNode
  badge?: string
}

type PlaceholderPageProps = {
  title: string
  subtitle: string
  icon: ReactNode
  nextPhase: string
  checklist: string[]
}

function useConnectionStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const updateStatus = () => setIsOnline(navigator.onLine)

    window.addEventListener('online', updateStatus)
    window.addEventListener('offline', updateStatus)

    return () => {
      window.removeEventListener('online', updateStatus)
      window.removeEventListener('offline', updateStatus)
    }
  }, [])

  return isOnline
}

function App() {
  const isOnline = useConnectionStatus()

  return (
    <div className="app-shell">
      <AppHeader isOnline={isOnline} />

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard isOnline={isOnline} />} />
          <Route
            path="/recebimento"
            element={
              <PlaceholderPage
                title="Receber no galpão"
                subtitle="Cadastro e conferência das bagagens que chegaram de cada município."
                icon={<PackageOpen aria-hidden="true" />}
                nextPhase="Na próxima fase, esta tela permitirá localizar o passageiro, informar a quantidade de volumes, vincular os lacres e fotografar o conjunto."
                checklist={[
                  'Selecionar a cidade de origem',
                  'Localizar ou cadastrar o passageiro',
                  'Conferir a quantidade declarada',
                  'Vincular um lacre a cada volume',
                  'Registrar a foto do conjunto',
                ]}
              />
            }
          />
          <Route
            path="/barretos"
            element={
              <PlaceholderPage
                title="Operação em Barretos"
                subtitle="Leitura rápida para descarregamento, troca das semanas e recolhimento."
                icon={<BusFront aria-hidden="true" />}
                nextPhase="O aplicativo abrirá a câmera em leitura contínua e bloqueará bagagens incompatíveis com a operação selecionada."
                checklist={[
                  'Escolher a operação do momento',
                  'Escanear cada lacre',
                  'Confirmar cidade, período e setor',
                  'Receber alerta em caso de leitura incorreta',
                  'Encerrar somente sem pendências',
                ]}
              />
            }
          />
          <Route
            path="/retorno"
            element={
              <PlaceholderPage
                title="Retorno ao galpão"
                subtitle="Recebimento da carreta e separação das bagagens por município."
                icon={<Truck aria-hidden="true" />}
                nextPhase="Esta tela fará a conferência entre o total esperado, o total recebido e os volumes ainda não localizados."
                checklist={[
                  'Abrir a conferência do retorno',
                  'Ler os lacres durante a descarga',
                  'Separar fisicamente por cidade',
                  'Apontar bagagens ausentes ou divergentes',
                  'Fechar a carga somente após revisão',
                ]}
              />
            }
          />
          <Route
            path="/entrega-cidades"
            element={
              <PlaceholderPage
                title="Entregar às cidades"
                subtitle="Transferência final das cargas aos caminhões responsáveis pelos municípios."
                icon={<Building2 aria-hidden="true" />}
                nextPhase="A futura confirmação registrará cidade, responsável, veículo, quantidade, data, horário e assinatura."
                checklist={[
                  'Selecionar a cidade',
                  'Conferir todos os volumes previstos',
                  'Identificar o responsável pela retirada',
                  'Registrar veículo e horário',
                  'Gerar comprovante de transferência',
                ]}
              />
            }
          />
          <Route
            path="/passageiros"
            element={
              <PlaceholderPage
                title="Passageiros"
                subtitle="Cadastros, cidades, períodos e quantidade prevista de volumes."
                icon={<UsersRound aria-hidden="true" />}
                nextPhase="Aqui ficarão o pré-cadastro, a pesquisa rápida e a visão de todos os volumes ligados a cada passageiro."
                checklist={[
                  'Pesquisar por nome, cidade ou telefone',
                  'Definir primeira, segunda ou duas semanas',
                  'Informar quantidade esperada',
                  'Visualizar foto do conjunto',
                  'Consultar histórico das bagagens',
                ]}
              />
            }
          />
          <Route
            path="/pendencias"
            element={
              <PlaceholderPage
                title="Pendências"
                subtitle="Tudo que exige atenção antes de fechar uma operação."
                icon={<AlertTriangle aria-hidden="true" />}
                nextPhase="O sistema reunirá aqui lacres duplicados, quantidades divergentes, bagagens fora da etapa e registros incompletos."
                checklist={[
                  'Bagagens ainda não localizadas',
                  'Cadastros incompletos',
                  'Leituras bloqueadas',
                  'Trocas de lacre',
                  'Diferenças por cidade',
                ]}
              />
            }
          />
          <Route
            path="/backup"
            element={
              <PlaceholderPage
                title="Backup e segurança"
                subtitle="Proteção do banco local, das fotos e do histórico operacional."
                icon={<ShieldCheck aria-hidden="true" />}
                nextPhase="Primeiro criaremos o banco local. Depois entraremos com exportação para o segundo celular e envio ao Google Drive quando houver internet."
                checklist={[
                  'Banco principal no aparelho',
                  'Cópias locais automáticas',
                  'Exportação para o celular reserva',
                  'Envio ao Google Drive',
                  'Teste real de restauração',
                ]}
              />
            }
          />
          <Route
            path="/configuracoes"
            element={
              <PlaceholderPage
                title="Configurações"
                subtitle="Cidades, cores, siglas, períodos e setores da carreta."
                icon={<Settings aria-hidden="true" />}
                nextPhase="Esta área será restrita e não ficará no caminho das operações do dia."
                checklist={[
                  'Cadastrar as 17 cidades',
                  'Definir siglas e cores',
                  'Definir períodos da viagem',
                  'Criar setores da carreta',
                  'Configurar dados da caravana',
                ]}
              />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <BottomNavigation />
    </div>
  )
}

function AppHeader({ isOnline }: { isOnline: boolean }) {
  const location = useLocation()
  const isDashboard = location.pathname === '/'

  return (
    <header className="app-header">
      <div className="brand-area">
        {!isDashboard ? (
          <Link to="/" className="icon-button" aria-label="Voltar ao início">
            <ArrowLeft aria-hidden="true" />
          </Link>
        ) : (
          <div className="brand-mark" aria-hidden="true">
            <BriefcaseBusiness />
          </div>
        )}

        <div>
          <p className="eyebrow">Caravana Flávio Gonçalves</p>
          <h1>Bagagens Barretão</h1>
        </div>
      </div>

      <div
        className={`connection-pill ${isOnline ? 'is-online' : 'is-offline'}`}
        title={isOnline ? 'Aparelho conectado' : 'Aparelho sem internet'}
      >
        {isOnline ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>
    </header>
  )
}

function Dashboard({ isOnline }: { isOnline: boolean }) {
  const operationCards: OperationCardProps[] = useMemo(
    () => [
      {
        title: 'Receber no galpão',
        description: 'Cadastrar passageiro, volumes, lacres e foto do conjunto.',
        path: '/recebimento',
        icon: <PackageOpen aria-hidden="true" />,
        sequence: '1',
        tone: 'blue',
      },
      {
        title: 'Operação em Barretos',
        description: 'Descarregar, trocar semanas e recolher com leitura dos lacres.',
        path: '/barretos',
        icon: <MapPinned aria-hidden="true" />,
        sequence: '2',
        tone: 'red',
      },
      {
        title: 'Retorno ao galpão',
        description: 'Conferir a carreta e separar todas as bagagens por cidade.',
        path: '/retorno',
        icon: <Truck aria-hidden="true" />,
        sequence: '3',
        tone: 'amber',
      },
      {
        title: 'Entregar às cidades',
        description: 'Transferir cada carga ao caminhão responsável pelo município.',
        path: '/entrega-cidades',
        icon: <PackageCheck aria-hidden="true" />,
        sequence: '4',
        tone: 'green',
      },
    ],
    [],
  )

  const secondaryActions: SecondaryActionProps[] = [
    {
      title: 'Passageiros',
      description: 'Cadastros e volumes',
      path: '/passageiros',
      icon: <UsersRound aria-hidden="true" />,
      badge: '0',
    },
    {
      title: 'Pendências',
      description: 'Itens para revisar',
      path: '/pendencias',
      icon: <AlertTriangle aria-hidden="true" />,
      badge: '0',
    },
    {
      title: 'Backup',
      description: 'Cópias e restauração',
      path: '/backup',
      icon: <Cloud aria-hidden="true" />,
    },
    {
      title: 'Configurações',
      description: 'Cidades e setores',
      path: '/configuracoes',
      icon: <Settings aria-hidden="true" />,
    },
  ]

  return (
    <div className="dashboard-page">
      <section className="status-banner">
        <div className="status-banner__icon">
          {isOnline ? <Cloud aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
        </div>
        <div>
          <strong>Protótipo inicial</strong>
          <p>
            Nenhum dado real está sendo salvo ainda. O banco offline será implantado
            na próxima etapa.
          </p>
        </div>
      </section>

      <section className="summary-section" aria-labelledby="resumo-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Visão geral</p>
            <h2 id="resumo-title">Operação ainda não iniciada</h2>
          </div>
          <span className="demo-tag">DEMONSTRAÇÃO</span>
        </div>

        <div className="summary-grid">
          <SummaryCard icon={<CircleUserRound />} label="Passageiros" value="0" />
          <SummaryCard icon={<Boxes />} label="Volumes" value="0" />
          <SummaryCard icon={<FileClock />} label="Pendências" value="0" />
          <SummaryCard icon={<Database />} label="Último backup" value="Nunca" compact />
        </div>
      </section>

      <section className="operations-section" aria-labelledby="operacoes-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fluxo principal</p>
            <h2 id="operacoes-title">O que você vai fazer agora?</h2>
          </div>
        </div>

        <div className="operation-grid">
          {operationCards.map((card) => (
            <OperationCard key={card.path} {...card} />
          ))}
        </div>
      </section>

      <section className="quick-section" aria-labelledby="atalhos-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Acesso rápido</p>
            <h2 id="atalhos-title">Consultas e segurança</h2>
          </div>
        </div>

        <div className="quick-grid">
          {secondaryActions.map((action) => (
            <SecondaryAction key={action.path} {...action} />
          ))}
        </div>
      </section>

      <section className="safety-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Segurança será silenciosa</strong>
          <p>
            Poucas etapas na tela, com bloqueios, horários e histórico funcionando por
            baixo do capô.
          </p>
        </div>
      </section>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  compact = false,
}: {
  icon: ReactNode
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <article className="summary-card">
      <div className="summary-card__icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong className={compact ? 'compact-value' : undefined}>{value}</strong>
      </div>
    </article>
  )
}

function OperationCard({
  title,
  description,
  path,
  icon,
  sequence,
  tone,
}: OperationCardProps) {
  return (
    <Link to={path} className={`operation-card tone-${tone}`}>
      <div className="operation-card__top">
        <span className="sequence-badge">{sequence}</span>
        <div className="operation-card__icon">{icon}</div>
      </div>

      <div className="operation-card__content">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <div className="operation-card__footer">
        <span>Abrir operação</span>
        <ChevronRight aria-hidden="true" />
      </div>
    </Link>
  )
}

function SecondaryAction({
  title,
  description,
  path,
  icon,
  badge,
}: SecondaryActionProps) {
  return (
    <Link to={path} className="quick-card">
      <div className="quick-card__icon">{icon}</div>
      <div className="quick-card__content">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {badge !== undefined && <span className="quick-card__badge">{badge}</span>}
      <ChevronRight className="quick-card__arrow" aria-hidden="true" />
    </Link>
  )
}

function PlaceholderPage({
  title,
  subtitle,
  icon,
  nextPhase,
  checklist,
}: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <section className="placeholder-hero">
        <div className="placeholder-hero__icon">{icon}</div>
        <div>
          <p className="eyebrow">Módulo operacional</p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </section>

      <section className="build-card">
        <div className="build-card__heading">
          <RefreshCcw aria-hidden="true" />
          <div>
            <span>Próxima fase</span>
            <h3>Estrutura funcional em preparação</h3>
          </div>
        </div>
        <p>{nextPhase}</p>
      </section>

      <section className="checklist-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Fluxo previsto</p>
            <h2>O que esta tela fará</h2>
          </div>
        </div>

        <div className="checklist">
          {checklist.map((item) => (
            <div className="checklist-item" key={item}>
              <CheckCircle2 aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <Link to="/" className="primary-button">
        <House aria-hidden="true" />
        Voltar ao painel
      </Link>
    </div>
  )
}

function NotFound() {
  return (
    <div className="placeholder-page">
      <section className="build-card">
        <div className="build-card__heading">
          <Search aria-hidden="true" />
          <div>
            <span>Página não encontrada</span>
            <h3>Este caminho não existe</h3>
          </div>
        </div>
        <p>Retorne ao painel principal para continuar.</p>
      </section>

      <Link to="/" className="primary-button">
        <House aria-hidden="true" />
        Ir para o painel
      </Link>
    </div>
  )
}

function BottomNavigation() {
  const location = useLocation()

  const items = [
    { path: '/', label: 'Início', icon: <House /> },
    { path: '/passageiros', label: 'Passageiros', icon: <UsersRound /> },
    { path: '/pendencias', label: 'Pendências', icon: <AlertTriangle /> },
    { path: '/backup', label: 'Backup', icon: <ShieldCheck /> },
  ]

  return (
    <nav className="bottom-navigation" aria-label="Navegação principal">
      {items.map((item) => {
        const isActive = location.pathname === item.path

        return (
          <Link
            key={item.path}
            to={item.path}
            className={isActive ? 'is-active' : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default App
