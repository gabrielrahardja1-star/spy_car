import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataSource } from '../data/DataProvider'
import { createMockDataSource } from '../data/mock'
import type { DataSource } from '../data/source'
import { createTraccarAuth } from '../data/traccar'
import { createTraccarDataSource } from '../data/traccar/dataSource'
import { createFakeBackend } from '../data/traccar/fake/backend'
import { createFakeFetch, createFakeRouter, DEMO_EMAIL, DEMO_PASSWORD } from '../data/traccar/fake/router'
import { FakeSocket } from '../test/fakeSocket'
import { FIXED_NOW } from '../test/render'
import { TraccarGate } from './TraccarGate'
import { useSession } from './session'

async function setup(opts: { signedIn?: boolean } = {}) {
  const now = () => FIXED_NOW
  const backend = await createFakeBackend(createMockDataSource({ now }), { now })
  const router = createFakeRouter(backend)
  const fetch = createFakeFetch(router)
  const auth = createTraccarAuth({ baseUrl: '', fetch })
  if (opts.signedIn) await auth.login(DEMO_EMAIL, DEMO_PASSWORD)
  let source: DataSource | null = null
  const createSource = (onUnauthorized: () => void) => {
    source = createTraccarDataSource({ baseUrl: '', fetch, now, WebSocketImpl: FakeSocket, onUnauthorized })
    return source
  }
  function Inside() {
    const session = useSession()
    useDataSource()
    return (
      <div>
        <p>App content</p>
        <button type="button" onClick={session?.logout}>
          Log out
        </button>
      </div>
    )
  }
  render(
    <TraccarGate auth={auth} createSource={createSource}>
      <Inside />
    </TraccarGate>,
  )
  return { router, fetch, auth, source: () => source as DataSource | null }
}

async function signIn(email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  await userEvent.type(await screen.findByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('TraccarGate', () => {
  beforeEach(() => {
    FakeSocket.all = []
  })

  it('shows the login screen when there is no session, then the app after a good login', async () => {
    await setup()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('App content')).toBeNull()
    await signIn()
    expect(await screen.findByText('App content')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  })

  it('skips the login screen when the browser already has a valid session', async () => {
    await setup({ signedIn: true })
    expect(await screen.findByText('App content')).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('keeps the login screen and says so on a wrong password', async () => {
    await setup()
    await signIn(DEMO_EMAIL, 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password')
    expect(screen.queryByText('App content')).toBeNull()
  })

  it('says "Can\'t reach the server" when the server is down, and works again once it is back', async () => {
    const { fetch } = await setup()
    await screen.findByRole('heading', { name: 'Sign in' })
    fetch.state.down = true
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server")
    fetch.state.down = false
    await userEvent.type(screen.getByLabelText('Password'), DEMO_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('App content')).toBeInTheDocument()
  })

  it('says "Can\'t reach the server" at start-up when the session check cannot get through', async () => {
    const now = () => FIXED_NOW
    const backend = await createFakeBackend(createMockDataSource({ now }), { now })
    const fetch = createFakeFetch(createFakeRouter(backend))
    fetch.state.down = true
    render(
      <TraccarGate auth={createTraccarAuth({ baseUrl: '', fetch })} createSource={() => createMockDataSource({ now })}>
        <p>App content</p>
      </TraccarGate>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server")
  })

  it('returns to the login screen when a call is answered 401 mid-session', async () => {
    const { router, source } = await setup({ signedIn: true })
    await screen.findByText('App content')
    router.expireSessions()
    await act(async () => {
      await source()?.getCars().catch(() => {})
    })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.')
    expect(screen.queryByText('App content')).toBeNull()
  })

  it('returns to the login screen when the live connection is refused because the session is gone', async () => {
    const { router } = await setup({ signedIn: true })
    await screen.findByText('App content')
    // The live connection opens a moment after the app renders: wait for it before dropping it.
    await waitFor(() => expect(FakeSocket.all.length).toBeGreaterThan(0))
    router.expireSessions()
    act(() => FakeSocket.last().drop())
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('logs out with the session control: back to the login screen, cookie gone, live link closed', async () => {
    const { fetch } = await setup({ signedIn: true })
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(fetch.cookie()).toBeUndefined()
    expect(FakeSocket.last().closed).toBe(true)
    expect(screen.queryByRole('status')).toBeNull() // logging out is not an "ended session"
  })

  it('opens a fresh live connection after signing in again', async () => {
    await setup({ signedIn: true })
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    const before = FakeSocket.all.length
    await signIn()
    await screen.findByText('App content')
    expect(FakeSocket.all.length).toBe(before + 1)
  })

  it('never writes the password to browser storage', async () => {
    await setup()
    await signIn()
    await screen.findByText('App content')
    expect(JSON.stringify({ ...localStorage })).not.toContain(DEMO_PASSWORD)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(DEMO_PASSWORD)
  })
})

