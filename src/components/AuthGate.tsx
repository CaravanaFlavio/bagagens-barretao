import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  inspectCloudSync,
  seedCloudFromThisDevice,
  startCloudSync,
  stopCloudSync,
  type CloudInspection,
} from '../data/cloudSync'
import {
  AUTHORIZED_FIREBASE_UID,
  firebaseAuth,
} from '../data/firebaseConfig'

interface AuthGateProps {
  children: ReactNode
}

type GateState =
  | { kind: 'CHECKING' }
  | { kind: 'LOGIN'; message?: string }
  | { kind: 'INSPECTING'; user: User }
  | { kind: 'NEEDS_SEED'; user: User; inspection: CloudInspection }
  | { kind: 'OFFLINE_FIRST_SYNC'; user: User; inspection: CloudInspection }
  | { kind: 'READY'; user: User }
  | { kind: 'ERROR'; message: string }

function firebaseErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''

  if (code.includes('auth/invalid-credential')) return 'E-mail ou senha inválidos.'
  if (code.includes('auth/too-many-requests')) return 'Muitas tentativas. Aguarde um pouco e tente novamente.'
  if (code.includes('auth/network-request-failed')) return 'Não foi possível acessar o Firebase. Confira a conexão.'
  return error instanceof Error ? error.message : 'Não foi possível concluir esta operação.'
}

async function prepareAuthenticatedUser(
  user: User,
  setGateState: (next: GateState) => void,
) {
  if (user.uid !== AUTHORIZED_FIREBASE_UID) {
    await signOut(firebaseAuth)
    setGateState({
      kind: 'LOGIN',
      message: 'Este usuário não está autorizado a acessar o Bagagens Barretão.',
    })
    return
  }

  setGateState({ kind: 'INSPECTING', user })
  try {
    const inspection = await inspectCloudSync()
    if (!inspection.online && !inspection.bootstrapped) {
      setGateState({ kind: 'OFFLINE_FIRST_SYNC', user, inspection })
      return
    }

    if (
      inspection.online &&
      inspection.cloudPassengerCount === 0 &&
      inspection.localPassengerCount > 0
    ) {
      setGateState({ kind: 'NEEDS_SEED', user, inspection })
      return
    }

    await startCloudSync()
    setGateState({ kind: 'READY', user })
  } catch (error) {
    setGateState({ kind: 'ERROR', message: firebaseErrorMessage(error) })
  }
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'CHECKING' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void setPersistence(firebaseAuth, browserLocalPersistence).catch((error) => {
      console.error('Não foi possível configurar a persistência do login:', error)
    })

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (!active) return
      if (!user) {
        stopCloudSync()
        setState({ kind: 'LOGIN' })
        return
      }
      void prepareAuthenticatedUser(user, setState)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (state.kind !== 'OFFLINE_FIRST_SYNC') return
    const retry = () => void prepareAuthenticatedUser(state.user, setState)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [state])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    try {
      await setPersistence(firebaseAuth, browserLocalPersistence)
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password)
    } catch (error) {
      setState({ kind: 'LOGIN', message: firebaseErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleSeed() {
    if (state.kind !== 'NEEDS_SEED') return
    setBusy(true)
    try {
      await seedCloudFromThisDevice()
      await startCloudSync()
      setState({ kind: 'READY', user: state.user })
    } catch (error) {
      setState({ kind: 'ERROR', message: firebaseErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'READY') return <>{children}</>

  if (state.kind === 'CHECKING' || state.kind === 'INSPECTING') {
    return <GateCard title="Preparando o Bagagens Barretão" text="Verificando acesso e sincronização local..." />
  }

  if (state.kind === 'OFFLINE_FIRST_SYNC') {
    return (
      <GateCard
        title="Primeira sincronização pendente"
        text={`Este dispositivo possui ${state.inspection.localPassengerCount} passageiro(s) localmente. Conecte-se à internet uma vez para vincular esta instalação à nuvem. Depois disso, o uso offline continuará disponível.`}
      />
    )
  }

  if (state.kind === 'NEEDS_SEED') {
    return (
      <GateCard
        title="Nuvem pronta para receber os dados"
        text={`O Firestore ainda está vazio e este dispositivo possui ${state.inspection.localPassengerCount} passageiro(s). Faça esta carga inicial somente no PC que contém a base oficial.`}
      >
        <button type="button" onClick={handleSeed} disabled={busy} style={primaryButtonStyle}>
          {busy ? 'Enviando...' : `Enviar ${state.inspection.localPassengerCount} passageiros para a nuvem`}
        </button>
      </GateCard>
    )
  }

  if (state.kind === 'ERROR') {
    return (
      <GateCard title="Não foi possível iniciar a sincronização" text={state.message}>
        <button type="button" onClick={() => window.location.reload()} style={primaryButtonStyle}>
          Tentar novamente
        </button>
      </GateCard>
    )
  }

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div>
          <p style={eyebrowStyle}>Bagagens Barretão</p>
          <h1 style={titleStyle}>Acesso à base da caravana</h1>
          <p style={textStyle}>Entre com o usuário autorizado. Depois do primeiro acesso, a sessão fica salva neste dispositivo para permitir o trabalho offline.</p>
        </div>

        <form onSubmit={handleLogin} style={formStyle}>
          <label style={labelStyle}>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
              autoComplete="username"
              disabled={busy}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Senha
            <input
              type="password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={busy}
              style={inputStyle}
            />
          </label>
          {state.message ? <p style={errorStyle}>{state.message}</p> : null}
          <button type="submit" disabled={busy} style={primaryButtonStyle}>
            {busy ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  )
}

function GateCard({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div>
          <p style={eyebrowStyle}>Bagagens Barretão</p>
          <h1 style={titleStyle}>{title}</h1>
          <p style={textStyle}>{text}</p>
        </div>
        {children}
      </section>
    </main>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: '#f6f7f9',
  color: '#172033',
} as const

const cardStyle = {
  width: 'min(100%, 460px)',
  display: 'grid',
  gap: '24px',
  padding: '28px',
  borderRadius: '20px',
  background: '#ffffff',
  boxShadow: '0 18px 48px rgba(23, 32, 51, 0.12)',
} as const

const eyebrowStyle = {
  margin: 0,
  fontSize: '13px',
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#52627a',
} as const

const titleStyle = {
  margin: '8px 0 10px',
  fontSize: '28px',
  lineHeight: 1.1,
} as const

const textStyle = {
  margin: 0,
  lineHeight: 1.55,
  color: '#52627a',
} as const

const formStyle = {
  display: 'grid',
  gap: '16px',
} as const

const labelStyle = {
  display: 'grid',
  gap: '7px',
  fontWeight: 700,
} as const

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #cfd6df',
  borderRadius: '12px',
  padding: '12px 14px',
  font: 'inherit',
} as const

const primaryButtonStyle = {
  border: 0,
  borderRadius: '12px',
  padding: '13px 16px',
  font: 'inherit',
  fontWeight: 800,
  cursor: 'pointer',
  background: '#1d5fd1',
  color: '#ffffff',
} as const

const errorStyle = {
  margin: 0,
  color: '#b42318',
  lineHeight: 1.4,
} as const
