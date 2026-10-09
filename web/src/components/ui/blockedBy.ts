import type { Async } from '../../data/hooks'

/** First state that is not ready (error wins over loading), or null when every state is ready. */
export function blockedBy(...states: Async<unknown>[]): Async<never> | null {
  const err = states.find((s) => s.status === 'error')
  if (err) return err as Async<never>
  const loading = states.find((s) => s.status === 'loading')
  return (loading as Async<never> | undefined) ?? null
}
