import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LoginResult } from '../../data/traccar'
import { Login } from './Login'

function setup(result: LoginResult | Promise<LoginResult> = { ok: true }, notice?: string | null) {
  const onSubmit = vi.fn(async () => result)
  render(<Login onSubmit={onSubmit} notice={notice} />)
  return onSubmit
}

async function fill(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
}

describe('Login', () => {
  it('has a heading, labelled email and password fields and a sign-in button', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('submits what was typed (email trimmed)', async () => {
    const onSubmit = setup()
    await fill(' user@example.com ', 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSubmit).toHaveBeenCalledWith('user@example.com', 'secret')
  })

  it('submits with the Enter key', async () => {
    const onSubmit = setup()
    await fill('user@example.com', 'secret{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not submit empty fields', async () => {
    const onSubmit = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows a loading state and ignores a second submit while waiting', async () => {
    let finish: (r: LoginResult) => void = () => {}
    const onSubmit = setup(new Promise<LoginResult>((resolve) => (finish = resolve)))
    await fill('a@b.c', 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const busy = screen.getByRole('button', { name: 'Signing in...' })
    expect(busy).toBeDisabled()
    await userEvent.click(busy)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    finish({ ok: false, reason: 'invalid' })
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('says "Wrong email or password", keeps the email and clears the password', async () => {
    setup({ ok: false, reason: 'invalid' })
    await fill('a@b.c', 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password')
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.c')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
  })

  it('says "Can\'t reach the server" when the server did not answer', async () => {
    setup({ ok: false, reason: 'unreachable' })
    await fill('a@b.c', 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server")
  })

  it('shows a notice from the app, e.g. an ended session, as a status and a failed start-up check as an alert', () => {
    const { unmount } = render(<Login onSubmit={async () => ({ ok: true })} notice="Your session ended. Sign in again." />)
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.')
    unmount()
    render(<Login onSubmit={async () => ({ ok: true })} notice="Can't reach the server" />)
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the server")
  })
})
