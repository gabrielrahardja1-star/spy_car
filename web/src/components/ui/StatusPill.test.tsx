import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill } from './StatusPill'

describe('StatusPill', () => {
  it.each([
    ['moving', 'Moving', 'round'],
    ['parked', 'Parked', 'square'],
    ['nosignal', 'No signal', 'dashed'],
  ] as const)('%s shows the word and a %s marker', (status, word, shape) => {
    const { container } = render(<StatusPill status={status} />)
    expect(screen.getByText(word)).toBeInTheDocument()
    expect(container.querySelector(`[data-shape="${shape}"]`)).not.toBeNull()
  })
})
