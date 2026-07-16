import { ArrowLeft, BriefcaseBusiness, Wifi, WifiOff } from 'lucide-react'
import { Link, useLocation } from 'react-router'

interface AppHeaderProps {
  isOnline: boolean
}

export function AppHeader({ isOnline }: AppHeaderProps) {
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

      <div className={`connection-pill ${isOnline ? 'is-online' : 'is-offline'}`}>
        {isOnline ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>
    </header>
  )
}
