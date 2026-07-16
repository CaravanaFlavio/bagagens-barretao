import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  MapPinned,
  PackageOpen,
  Search,
  Settings,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import { Link, Route, Routes } from 'react-router'
import { AppHeader } from './components/AppHeader'
import { BottomNavigation } from './components/BottomNavigation'
import { DashboardPage } from './pages/DashboardPage'
import { PassengersPage } from './pages/PassengersPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import './App.css'

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
          <Route path="/" element={<DashboardPage isOnline={isOnline} />} />
          <Route path="/passageiros" element={<PassengersPage />} />
          <Route
            path="/recebimento"
            element={
              <PlaceholderPage
                title="Receber no galpão"
                subtitle="Localize o passageiro já cadastrado e registre os volumes recebidos."
                icon={<PackageOpen aria-hidden="true" />}
                nextPhase="Esta operação reaproveitará o cadastro de bagagens já criado na tela de passageiros e acrescentará foto do conjunto e conferência por cidade."
                checklist={[
                  'Selecionar a cidade de origem',
                  'Localizar o passageiro',
                  'Cadastrar ou conferir os lacres',
                  'Fotografar o conjunto',
                  'Finalizar com alerta de passageiros sem bagagem',
                ]}
              />
            }
          />
          <Route
            path="/barretos"
            element={
              <PlaceholderPage
                title="Operação em Barretos"
                subtitle="Entrega e recolhimento separados por semana."
                icon={<MapPinned aria-hidden="true" />}
                nextPhase="A lista mostrará somente os passageiros daquela etapa: entrega da 1ª, recolhimento da 1ª, entrega da 2ª ou recolhimento da 2ª."
                checklist={[
                  'Mostrar somente quem pertence à etapa',
                  'Destacar passageiros das duas semanas',
                  'Ler lacres em sequência',
                  'Bloquear período incompatível',
                  'Finalizar apontando volumes que sobraram',
                ]}
              />
            }
          />
          <Route
            path="/retorno"
            element={
              <PlaceholderPage
                title="Retorno ao galpão"
                subtitle="Conferência da carreta e separação das bagagens por município."
                icon={<Truck aria-hidden="true" />}
                nextPhase="O aplicativo comparará o total esperado com o descarregado e mostrará qualquer volume ainda não localizado."
                checklist={[
                  'Ler cada lacre na descarga',
                  'Separar fisicamente por cidade',
                  'Mostrar o que ainda consta na carreta',
                  'Registrar divergências',
                  'Gerar relatório final por bagagem',
                ]}
              />
            }
          />
          <Route
            path="/entrega-cidades"
            element={
              <PlaceholderPage
                title="Entregar às cidades"
                subtitle="Transferência final das cargas aos responsáveis pelos caminhões."
                icon={<Building2 aria-hidden="true" />}
                nextPhase="A confirmação registrará a cidade, o total de volumes, o responsável, o veículo, o dia e o horário."
                checklist={[
                  'Selecionar a cidade',
                  'Conferir os volumes',
                  'Identificar o responsável',
                  'Registrar veículo e horário',
                  'Gerar comprovante de transferência',
                ]}
              />
            }
          />
          <Route
            path="/pendencias"
            element={
              <PlaceholderPage
                title="Pendências"
                subtitle="Alertas que precisam ser resolvidos antes de finalizar uma etapa."
                icon={<AlertTriangle aria-hidden="true" />}
                nextPhase="Aqui aparecerão passageiros sem bagagem, volumes que sobraram, códigos duplicados e movimentações incompatíveis."
                checklist={[
                  'Passageiro sem bagagem cadastrada',
                  'Bagagem que não foi movimentada',
                  'Quantidade diferente do esperado',
                  'Período incompatível',
                  'Exceção confirmada com justificativa',
                ]}
              />
            }
          />
          <Route
            path="/backup"
            element={
              <PlaceholderPage
                title="Backup e segurança"
                subtitle="Cópias do banco, das fotos e do histórico operacional."
                icon={<ShieldCheck aria-hidden="true" />}
                nextPhase="Depois do banco nativo no APK, entraremos com backup para o segundo celular e envio ao Google Drive quando houver conexão."
                checklist={[
                  'Banco local no aparelho',
                  'Exportação criptografada',
                  'Cópia para o celular reserva',
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
                subtitle="Cidades, cores, siglas e setores da carreta."
                icon={<Settings aria-hidden="true" />}
                nextPhase="As 17 cidades já estão disponíveis no cadastro. A próxima configuração será o mapa de cores e setores."
                checklist={[
                  'Editar cidades e siglas',
                  'Vincular cores dos lacres',
                  'Definir os setores da carreta',
                  'Configurar dados da caravana',
                  'Restringir alterações durante a operação',
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
      <Link to="/" className="primary-button">Voltar ao painel</Link>
    </div>
  )
}

export default App
