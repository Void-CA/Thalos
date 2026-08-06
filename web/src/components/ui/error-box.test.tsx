// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ErrorBox } from './error-box'

afterEach(() => cleanup())

/**
 * ErrorBox render contract (error-ux spec, R3-003): the shared error container
 * must resolve `{message, code?}` shapes to the REAL message. Regression: an
 * execution error with `code: undefined` (network errors — ApiError without a
 * machine-readable code) satisfied `'code' in error` and fell into describeError,
 * which isCodedError rejects → 'Operation failed', swallowing the real message.
 */
describe('ErrorBox — renders the real message for every error shape (R3-003)', () => {
  it('renders the message, not Operation failed, when code is undefined', () => {
    render(<ErrorBox error={{ message: 'Network is unreachable', code: undefined }} />)
    expect(screen.getByText('Network is unreachable')).toBeInTheDocument()
    expect(screen.queryByText('Operation failed')).not.toBeInTheDocument()
  })

  it('renders a plain string verbatim', () => {
    render(<ErrorBox error="Backend rejected the request" />)
    expect(screen.getByText('Backend rejected the request')).toBeInTheDocument()
  })

  it('renders the code-to-CTA for a coded error (error-ux spec)', () => {
    render(<ErrorBox error={{ message: 'No plan', code: 'no_active_plan' }} />)
    expect(
      screen.getByText(/Preview a motion program in Programación first/),
    ).toBeInTheDocument()
  })

  it('renders a plain Error message via describeError', () => {
    render(<ErrorBox error={new Error('Something exploded')} />)
    expect(screen.getByText('Something exploded')).toBeInTheDocument()
  })

  it('renders nothing for a null error', () => {
    const { container } = render(<ErrorBox error={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('ErrorBox — retry button (error-ux spec, resilience-presentation)', () => {
  it('renders a Reintentar button for network_error when onRetry is provided', () => {
    const onRetry = vi.fn()
    render(<ErrorBox error={{ message: 'Backend is offline', code: 'network_error' }} onRetry={onRetry} />)
    const button = screen.getByRole('button', { name: 'Reintentar' })
    expect(button).toBeInTheDocument()
    button.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders a Reintentar button for timeout_error when onRetry is provided', () => {
    render(<ErrorBox error={{ message: 'Request timed out', code: 'timeout_error' }} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('renders the code-specific CTA label for no_firmware (Cambiar a simulación)', () => {
    render(<ErrorBox error={{ message: 'No firmware detected', code: 'no_firmware' }} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cambiar a simulación' })).toBeInTheDocument()
  })

  it('shows no button when onRetry is omitted (R3-003 non-coded fallback untouched)', () => {
    render(<ErrorBox error={{ message: 'Backend is offline', code: 'network_error' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
