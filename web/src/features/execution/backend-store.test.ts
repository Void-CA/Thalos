import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBackendStore } from './backend-store'
import { backendApi } from './backend-api'
import { ApiError } from '@/shared/errors'

/**
 * Backend store (execution-backend-switch-ui spec, requirement "Backend
 * Selector UI"): fetches the registered backends, tracks the active one, and
 * drives activate/connect/disconnect through the API, preserving the backend
 * machine-readable `code` in errors so the UI can render code→CTA labels.
 */
vi.mock('./backend-api', () => ({
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
  useBackendStore.setState({ backends: [], activeId: null, loading: false, error: null })
  Object.values(api).forEach((m) => m.mockClear())
})

describe('backend-store — list + active tracking', () => {
  it('fetchBackends stores the list and marks the active backend', async () => {
    api.list.mockResolvedValue([SIM, ESP])
    await useBackendStore.getState().fetchBackends()
    const s = useBackendStore.getState()
    expect(s.backends).toEqual([SIM, ESP])
    expect(s.activeId).toBe('simulation')
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  it('fetchBackends maps no active backend when none is active', async () => {
    api.list.mockResolvedValue([{ ...ESP, status: 'inactive' }])
    await useBackendStore.getState().fetchBackends()
    expect(useBackendStore.getState().activeId).toBeNull()
  })

  it('fetchBackends preserves the API code in errors (network_error)', async () => {
    // The interceptor wraps network failures in a coded ApiError (PR1).
    api.list.mockRejectedValue(new ApiError('Backend is offline', { code: 'network_error' }))
    await useBackendStore.getState().fetchBackends()
    const s = useBackendStore.getState()
    expect(s.error?.message).toBe('Backend is offline')
    expect(s.error?.code).toBe('network_error')
    expect(s.loading).toBe(false)
  })
})

describe('backend-store — activate/connect/disconnect actions', () => {
  it('activate calls the API with the id and refreshes the list', async () => {
    api.activate.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([{ ...SIM, status: 'inactive' }, { ...ESP, status: 'active' }])
    await useBackendStore.getState().activate('esp32')
    expect(api.activate).toHaveBeenCalledWith('esp32')
    expect(api.list).toHaveBeenCalled()
    expect(useBackendStore.getState().activeId).toBe('esp32')
  })

  it('connect calls the API with the id and port', async () => {
    api.connect.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([SIM, { ...ESP, connected: true }])
    await useBackendStore.getState().connect('esp32', '/dev/ttyUSB0')
    expect(api.connect).toHaveBeenCalledWith('esp32', '/dev/ttyUSB0')
    expect(useBackendStore.getState().error).toBeNull()
  })

  it('connect surfaces no_firmware errors with the code preserved', async () => {
    // The backend answers 400 with code no_firmware; ApiError preserves it.
    api.connect.mockRejectedValue(
      new ApiError('no firmware detected on the serial port — switch to Simulation or check the port', {
        code: 'no_firmware',
        status: 400,
      }),
    )
    await expect(useBackendStore.getState().connect('esp32', '/dev/ttyUSB0')).rejects.toThrow()
    expect(useBackendStore.getState().error?.code).toBe('no_firmware')
  })

  it('disconnect calls the API with the id', async () => {
    api.disconnect.mockResolvedValue({ status: 'ok' })
    api.list.mockResolvedValue([SIM, { ...ESP, connected: false }])
    await useBackendStore.getState().disconnect('esp32')
    expect(api.disconnect).toHaveBeenCalledWith('esp32')
    expect(useBackendStore.getState().error).toBeNull()
  })
})
