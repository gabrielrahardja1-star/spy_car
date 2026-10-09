import { createContext, useContext } from 'react'

/** Set only in Traccar mode, where there is a session to end. Mock mode has none, so the header shows no log-out button. */
export interface SessionControls {
  logout: () => void
}

export const SessionContext = createContext<SessionControls | null>(null)

export function useSession(): SessionControls | null {
  return useContext(SessionContext)
}
