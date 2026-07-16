import { AlertTriangle, House, ShieldCheck, UsersRound } from 'lucide-react'
import { Link, useLocation } from 'react-router'

const items = [
  { path: '/', label: 'Início', icon: House },
  { path: '/passageiros', label: 'Passageiros', icon: UsersRound },
  { path: '/pendencias', label: 'Pendências', icon: AlertTriangle },
  { path: '/backup', label: 'Backup', icon: ShieldCheck },
]

export function BottomNavigation() {
  const location = useLocation()

  return (
    <nav className="bottom-navigation" aria-label="Navegação principal">
      {items.map((item) => {
        const Icon = item.icon
        const isActive = location.pathname === item.path

        return (
          <Link key={item.path} to={item.path} className={isActive ? 'is-active' : undefined}>
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
