import { useEffect, useState } from 'react'
import {
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { Link, Route, Routes } from 'react-router'
import { AppHeader } from './components/AppHeader'
import { BottomNavigation } from './components/BottomNavigation'
import { DashboardPage } from './pages/DashboardPage'
import { PassengersPage } from './pages/PassengersPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { PendenciesPage } from './pages/PendenciesPage'
import { BarretosPage } from './pages/BarretosPage'
import { LuggageOperationPage } from './pages/LuggageOperationPage'
import { CityDeliveryPage } from './pages/CityDeliveryPage'
import { ContingencyPage } from './pages/ContingencyPage'
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
            element={<LuggageOperationPage operationKey="WAREHOUSE_TO_TRAILER" />}
          />
          <Route path="/barretos" element={<BarretosPage />} />
          <Route
            path="/barretos/entrega-primeira"
            element={<LuggageOperationPage operationKey="DELIVER_FIRST_WEEK" />}
          />
          <Route
            path="/barretos/recolhimento-primeira"
            element={<LuggageOperationPage operationKey="COLLECT_FIRST_WEEK" />}
          />
          <Route
            path="/barretos/entrega-segunda"
            element={<LuggageOperationPage operationKey="DELIVER_SECOND_WEEK" />}
          />
          <Route
            path="/barretos/recolhimento-segunda"
            element={<LuggageOperationPage operationKey="COLLECT_SECOND_WEEK" />}
          />
          <Route
            path="/retorno"
            element={<LuggageOperationPage operationKey="TRAILER_TO_WAREHOUSE" />}
          />
          <Route path="/entrega-cidades" element={<CityDeliveryPage />} />
          <Route path="/pendencias" element={<PendenciesPage />} />
          <Route path="/contingencia" element={<ContingencyPage />} />
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
