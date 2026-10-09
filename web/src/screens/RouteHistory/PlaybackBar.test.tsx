import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { localTime } from '../../test/render'
import { PlaybackBar, type PlaybackBarProps } from './PlaybackBar'

function setup(over: Partial<PlaybackBarProps> = {}) {
  const props: PlaybackBarProps = {
    disabled: false,
    playing: false,
    speed: 4,
    time: localTime(8, 14),
    fraction: 0.385,
    start: localTime(7, 42),
    end: localTime(9, 5),
    ticks: [0.193, 0.65],
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onCycleSpeed: vi.fn(),
    ...over,
  }
  const view = render(<PlaybackBar {...props} />)
  return { props, ...view }
}

describe('PlaybackBar', () => {
  it('shows the replay time, the start and end times and the speed', () => {
    setup()
    const bar = screen.getByRole('group', { name: 'Playback' })
    expect(within(bar).getAllByText(/^\d\d:\d\d$/).map((e) => e.textContent)).toEqual(['08:14', '07:42', '09:05'])
    expect(screen.getByRole('button', { name: 'Playback speed, 4 times' })).toHaveTextContent('4×')
  })

  it('says "now" at the end of a trip still under way', () => {
    setup({ end: null })
    expect(screen.getByText('now')).toBeInTheDocument()
  })

  it('labels the play button by what it will do, and calls back', async () => {
    const { props, rerender } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Play route' }))
    expect(props.onToggle).toHaveBeenCalledTimes(1)
    rerender(<PlaybackBar {...props} playing />)
    expect(screen.getByRole('button', { name: 'Pause route' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play route' })).toBeNull()
  })

  it('asks for the next speed when the speed button is pressed', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: /Playback speed/ }))
    expect(props.onCycleSpeed).toHaveBeenCalledTimes(1)
  })

  it('names the speed in the label whichever it is', () => {
    const { props, rerender } = setup({ speed: 1 })
    expect(screen.getByRole('button', { name: 'Playback speed, 1 times' })).toHaveTextContent('1×')
    rerender(<PlaybackBar {...props} speed={8} />)
    expect(screen.getByRole('button', { name: 'Playback speed, 8 times' })).toHaveTextContent('8×')
  })

  it('has a slider for the position with the clock time as its value text', () => {
    setup()
    const slider = screen.getByRole('slider', { name: 'Playback position' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '1000')
    expect(slider).toHaveAttribute('step', '1')
    expect(slider).toHaveValue('385')
    expect(slider).toHaveAttribute('aria-valuetext', '08:14')
  })

  it('seeks while the thumb is dragged', () => {
    const { props } = setup()
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '500' } })
    expect(props.onSeek).toHaveBeenLastCalledWith(0.5)
  })

  it('seeks from the keyboard: arrows by 1%, Page keys by 10%, Home and End to the ends', async () => {
    const { props } = setup({ fraction: 0.5 })
    await userEvent.tab() // play button
    await userEvent.tab() // slider
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveFocus()
    const seek = props.onSeek as ReturnType<typeof vi.fn>
    await userEvent.keyboard('{ArrowRight}')
    expect(seek).toHaveBeenLastCalledWith(0.51)
    await userEvent.keyboard('{ArrowLeft}')
    expect(seek).toHaveBeenLastCalledWith(0.49)
    await userEvent.keyboard('{PageUp}')
    expect(seek).toHaveBeenLastCalledWith(0.6)
    await userEvent.keyboard('{PageDown}')
    expect(seek).toHaveBeenLastCalledWith(0.4)
    await userEvent.keyboard('{Home}')
    expect(seek).toHaveBeenLastCalledWith(0)
    await userEvent.keyboard('{End}')
    expect(seek).toHaveBeenLastCalledWith(1)
  })

  it('does not step past either end', async () => {
    const { props } = setup({ fraction: 0.995 })
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(props.onSeek).toHaveBeenLastCalledWith(1)
  })

  it('draws one orange tick per stop', () => {
    const { container } = setup({ ticks: [0.1, 0.5, 0.9] })
    expect([...container.querySelectorAll<HTMLElement>('[style*="left"]')].map((e) => e.style.left)).toEqual(['10%', '50%', '90%'])
  })

  it('is disabled, and says so, when there is nothing to replay', async () => {
    const { props } = setup({ disabled: true, time: null, start: null, end: null, ticks: [], fraction: 0 })
    expect(screen.getByRole('group', { name: 'Playback' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Play route' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Playback speed/ })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '--:--')
    expect(screen.getAllByText('--:--').length).toBeGreaterThanOrEqual(3)
    await userEvent.click(screen.getByRole('button', { name: 'Play route' }))
    expect(props.onToggle).not.toHaveBeenCalled()
  })

  it('is not marked disabled when it can play', () => {
    setup()
    expect(screen.getByRole('group', { name: 'Playback' })).not.toHaveAttribute('aria-disabled')
  })
})
