// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { BackendSelector } from './backend-selector'
import { useBackendStore } from '../backend-store'
import { backendApi } from '../backend-api'

/**
 * Backend selector UI (execution-backend-switch-ui spec): replaces the
 * informational badge with an interactive Simulation/Hardware selector, a port
 * input for hardware, Connect/Disconnect, and the no_firmware /
 * port_in_use CTAs. Every failure keeps the selector interactive (coherent
 * state: button re-enabled, error cleared on CTA success).
 */
vi.mock('../backend-api', () => ({
  backendApi: {
    list: vi.fn(),
    activate: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}))

const api = backendApi as unknown as {
  list: ReturnType<typeof vi.fn>
  activate: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const SIM = { id: 'simulation', name: 'Simulation', status: 'active', connected: true, port: null }
const ESP = { id: 'esp32', name: 'Hardware (ESP32)', status: 'inactive', connected: false, port: '/dev/ttyUSB0' }

beforeEach(() => {
  useBackendStore.setState({ backends: [SIM, ESP], activeId: 'simulation', loading: false, error: null })
  Object.values(api).forEach((m) => m.mockReset())
  api.list.mockResolvedValue([SIM, ESP])
})
afterEach(() => cleanup())

describe('BackendSelector — available backends + active highlight (spec)', () => {
  it('shows Simulation and Hardware options with the active one highlighted', () => {
    render(<BackendSelector />)
    expect(screen.getByRole('button', { name: /Simulation/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hardware/ })).toBeInTheDocument()
  })

  it('switching to Hardware sends POST activate and reveals the port input', async () => {
    api.activate.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([
      { ...SIM, status: 'inactive' },
      { ...ESP, status: 'active', connected: false },
    ])
    render(<BackendSelector />)

    fireEvent.click(screen.getByRole('button', { name: /Hardware/ }))
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('esp32'))
    await waitFor(() => expect(useBackendStore.getState().activeId).toBe('esp32'))
    // Port input appears, pre-filled from the backend DTO port.
    await waitFor(() => {
      expect(screen.getByLabelText('Port')).toBeInTheDocument()
    })
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('/dev/ttyUSB0')
  })

  it('switching back to Simulation hides the port input', async () => {
    api.activate.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([{ ...SIM, status: 'active' }, { ...ESP, status: 'inactive' }])
    useBackendStore.setState({ activeId: 'esp32' })
    render(<BackendSelector />)

    fireEvent.click(screen.getByRole('button', { name: /Simulation/ }))
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('simulation'))
    await waitFor(() => {
      expect(screen.queryByLabelText('Port')).not.toBeInTheDocument()
    })
  })
})

describe('BackendSelector — Connect / Disconnect (spec)', () => {
  it('Connect sends POST connect with the entered port and flips to Disconnect on success', async () => {
    api.connect.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([{ ...SIM, status: 'inactive' }, { ...ESP, status: 'active', connected: true }])
    useBackendStore.setState({ activeId: 'esp32' })
    render(<BackendSelector />)

    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '/dev/ttyUSB0' } })
    fireEvent.click(screen.getByRole('button', { name: /Connect/ }))

    await waitFor(() => expect(api.connect).toHaveBeenCalledWith('esp32', '/dev/ttyUSB0'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Disconnect/ })).toBeInTheDocument())
    expect(screen.getByText(/Connected/)).toBeInTheDocument()
  })

  it('Disconnect sends POST disconnect and flips back to Connect', async () => {
    api.disconnect.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([{ ...SIM, status: 'inactive' }, { ...ESP, status: 'active', connected: false }])
    useBackendStore.setState({ activeId: 'esp32', backends: [SIM, { ...ESP, status: 'active', connected: true }] })
    render(<BackendSelector />)

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('esp32'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Connect/ })).toBeInTheDocument())
  })

  it('no_firmware error shows the Switch to Simulation CTA which activates Simulation and clears the error', async () => {
    api.activate.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([{ ...SIM, status: 'active' }, { ...ESP, status: 'inactive' }])
    useBackendStore.setState({
      activeId: 'esp32',
      error: { message: 'no firmware detected on the serial port — switch to Simulation or check the port', code: 'no_firmware' },
    })
    render(<BackendSelector />)

    const cta = screen.getByRole('button', { name: 'Switch to Simulation' })
    expect(cta).toBeInTheDocument()
    fireEvent.click(cta)

    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('simulation'))
    await waitFor(() => expect(useBackendStore.getState().activeId).toBe('simulation'))
    await waitFor(() => expect(useBackendStore.getState().error).toBeNull())
    // Coherent end state: Simulation is selected (aria-pressed) and the port
    // input is gone — the user can immediately start execution.
    expect(screen.getByRole('button', { name: 'Simulation' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('Port')).not.toBeInTheDocument()
  })

  it('port_in_use error shows the Choose another port CTA', () => {
    useBackendStore.setState({
      activeId: 'esp32',
      error: { message: 'serial port is in use or cannot be opened: boom', code: 'port_in_use' },
    })
    render(<BackendSelector />)
    expect(screen.getByRole('button', { name: 'Choose another port' })).toBeInTheDocument()
  })
})

describe('BackendSelector — status display (spec)', () => {
  it('shows Hardware (Connected) when the active hardware backend is connected', () => {
    useBackendStore.setState({ activeId: 'esp32', backends: [SIM, { ...ESP, status: 'active', connected: true }] })
    render(<BackendSelector />)
    expect(screen.getByText(/Hardware \(Connected\)/)).toBeInTheDocument()
  })

  it('shows Hardware (Disconnected) when the active hardware backend is not connected', () => {
    useBackendStore.setState({ activeId: 'esp32', backends: [SIM, { ...ESP, status: 'active', connected: false }] })
    render(<BackendSelector />)
    expect(screen.getByText(/Hardware \(Disconnected\)/)).toBeInTheDocument()
  })
})
