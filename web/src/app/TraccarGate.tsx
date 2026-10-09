import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { TraccarAuth } from '../data/traccar'
import { DataProvider } from '../data/DataProvider'
import type { DataSource } from '../data/source'
import { Login } from '../screens/Login/Login'
import { SessionContext } from './session'

type Phase = 'checking' | 'loggedOut' | 'loggedIn'

interface Props {
  auth: TraccarAuth
  /** Builds a fresh source for each sign-in. `onUnauthorized` must be called when the server rejects the session. */
  createSource: (onUnauthorized: () => void) => DataSource
  children: ReactNode
}

/**
 * Shows the login screen until there is a valid Traccar session, then the app. A 401 from any call (or a refused
 * live connection) sends the user back to the login screen. Credentials only pass through the form; the session
 * cookie is the only thing that persists, and the browser holds it.
 */
export function TraccarGate({ auth, createSource, children }: Props) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  const [signIns, setSignIns] = useState(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    let cancelled = false
    void auth.checkSession().then((check) => {
      if (cancelled) return
      if (check === 'valid') setPhase('loggedIn')
      else {
        if (check === 'unreachable') setNotice("Can't reach the server")
        setPhase('loggedOut')
      }
    })
    return () => {
      cancelled = true
    }
  }, [auth])

  const onUnauthorized = useCallback(() => {
    if (phaseRef.current !== 'loggedIn') return
    setNotice('Your session ended. Sign in again.')
    setPhase('loggedOut')
  }, [])

  // A new source (and so a new live connection and empty caches) for every sign-in.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => createSource(onUnauthorized), [signIns, createSource, onUnauthorized])

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await auth.login(email, password)
      if (result.ok) {
        setNotice(null)
        setSignIns((n) => n + 1)
        setPhase('loggedIn')
      }
      return result
    },
    [auth],
  )

  const controls = useMemo(
    () => ({
      logout: () => {
        setNotice(null)
        setPhase('loggedOut')
        void auth.logout()
      },
    }),
    [auth],
  )

  if (phase === 'checking') return <div role="status" style={{ padding: 24 }}>Loading...</div>
  if (phase === 'loggedOut') return <Login onSubmit={login} notice={notice} />
  return (
    <SessionContext.Provider value={controls}>
      <DataProvider source={source}>{children}</DataProvider>
    </SessionContext.Provider>
  )
}
