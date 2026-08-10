// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { ExecutionWorkspace } from './execution-workspace'
import { useExecutionStore } from './execution-store'
import { useBackendStore } from './backend-store'
import { ApiError } from '@/shared/errors'
import type { ActivePlanInfo, ExecutionStatus } from './execution-store'
import { useSceneStore } from '@/features/viewport/store'

/**
 * Behavior tests for the execution-workspace spec (slice 4, task 4.2):
 *
 * - Execution owns the lifecycle: controls are enabled/disabled exactly by
 *   `execStatus` (spec table), and the tick loop ONLY starts from here.
 * - The Active Plan card renders handoff metadata (instruction count,
 *   duration, TaskDocument source) or a clear empty state.
 * - `loadExecution` decision: the handoff loads via `executeSemantic` and
 *   `receivePlan()` sets `ready` — the store no longer exposes `loadExecution`
 *   (zero callers, dead code), which these tests cover by exercising only the
 *   receivePlan handoff path.
 */

const execClientMocks = vi.hoisted(() => ({
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
  tick: vi.fn(),
}))

vi.mock('@/features/execution/execution-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/execution/execution-client')>()
  return { ...actual, executionClient: execClientMocks }
})

const backendApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  activate: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('@/features/execution/backend-api', () => ({
  backendApi: backendApiMocks,
}))

const SIM_BACKEND = { id: 'simulation', name: 'Simulation', status: 'active', connected: true, port: null }
const ESP_BACKEND = { id: 'esp32', name: 'Hardware (ESP32)', status: 'inactive', connected: false, port: '/dev/ttyUSB0' }

const plan: ActivePlanInfo = { instructionCount: 4, durationSecs: 12.5, source: 'TaskDocument' }
/** PR2: a plan mirrored from the Planning workspace preview (motion-program spec). */
const motionProgramPlan: ActivePlanInfo = { instructionCount: 3, durationSecs: 8.0, source: 'Motion Program' }

/** A terminal tick delta — lets the rAF loop run exactly once and stop. */
const completedDelta = {
  joints: [],
  transforms: [],
  execution: { status: 'Completed', progress: 1, elapsed_secs: 12.5 },
}

function renderWorkspace() {
  return render(<ExecutionWorkspace />)
}

/** Seed the execution store to a status (act-wrapped). */
function setStatus(status: ExecutionStatus, extra: Partial<typeof useExecutionStore.getState> = {}) {
  act(() => {
    useExecutionStore.setState({ status, ...extra } as never)
  })
}

beforeEach(() => {
  Object.values(execClientMocks).forEach((m) => m.mockClear())
  Object.values(backendApiMocks).forEach((m) => m.mockReset())
  backendApiMocks.list.mockResolvedValue([SIM_BACKEND, ESP_BACKEND])
  useExecutionStore.setState({
    status: 'idle',
    activePlan: null,
    progress: 0,
    elapsedSecs: 0,
    error: null,
    source: 'Simulation',
    mode: 'once',
    iteration: 1,
    totalIterations: undefined,
  })
  act(() => {
    useSceneStore.setState({ execution: null } as never)
    useBackendStore.setState({ backends: [SIM_BACKEND, ESP_BACKEND], activeId: 'simulation', loading: false, error: null })
  })
})
afterEach(() => cleanup())

describe('Active Plan card (execution-workspace spec)', () => {
  it('shows a clear empty state until a plan is handed off', () => {
    setStatus('idle')
    renderWorkspace()
    expect(screen.getByText('No plan loaded — send from Task or preview a Motion Program')).toBeInTheDocument()
  })

  it('renders instruction count, estimated duration and the TaskDocument source after handoff', () => {
    setStatus('ready', { activePlan: plan })
    renderWorkspace()
    expect(screen.getByText(/4 instructions/)).toBeInTheDocument()
    expect(screen.getByText(/Est\. 12\.5s/)).toBeInTheDocument()
    expect(screen.getByText(/Source: TaskDocument/)).toBeInTheDocument()
  })

  it('reflects the Motion Program source for a plan received from the planning preview', () => {
    setStatus('ready', { activePlan: motionProgramPlan })
    renderWorkspace()
    expect(screen.getByText(/3 instructions/)).toBeInTheDocument()
    expect(screen.getByText(/Est\. 8\.0s/)).toBeInTheDocument()
    expect(screen.getByText(/Source: Motion Program/)).toBeInTheDocument()
  })
})

describe('Lifecycle controls follow the execStatus table (spec)', () => {
  const EXPECTED_ENABLED: Record<ExecutionStatus, Record<string, boolean>> = {
    ready: { Start: true, Pause: false, Resume: false, Cancel: false, Reset: false },
    running: { Start: false, Pause: true, Resume: false, Cancel: true, Reset: false },
    paused: { Start: false, Pause: false, Resume: true, Cancel: true, Reset: false },
    completed: { Start: false, Pause: false, Resume: false, Cancel: false, Reset: true },
    failed: { Start: false, Pause: false, Resume: false, Cancel: false, Reset: true },
    idle: { Start: false, Pause: false, Resume: false, Cancel: false, Reset: false },
    loading: { Start: false, Pause: false, Resume: false, Cancel: false, Reset: false },
    cancelled: { Start: false, Pause: false, Resume: false, Cancel: false, Reset: false },
  }

  it.each(Object.entries(EXPECTED_ENABLED))(
    'in %s status exactly these controls are enabled: %j',
    (status, expected) => {
      setStatus(status as ExecutionStatus)
      renderWorkspace()
      for (const [label, enabled] of Object.entries(expected)) {
        const button = screen.getByRole('button', { name: label })
        if (enabled) {
          expect(button).toBeEnabled()
        } else {
          expect(button).toBeDisabled()
        }
      }
    },
  )
})

describe('Tick loop ownership — only the Execution workspace starts it', () => {
  it('Start calls executionClient.start(), marks running, and the tick loop fires ticks until terminal', async () => {
    execClientMocks.start.mockResolvedValue(undefined)
    execClientMocks.tick.mockResolvedValue(completedDelta)
    setStatus('ready', { activePlan: plan })
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(execClientMocks.start).toHaveBeenCalledTimes(1))
    expect(useExecutionStore.getState().status).toBe('running')

    // The rAF loop begins calling POST /scene/motion/tick…
    await waitFor(() => expect(execClientMocks.tick).toHaveBeenCalled())
    // …and stops at the terminal Completed state (no infinite loop).
    await waitFor(() => expect(useExecutionStore.getState().status).toBe('completed'))
  })

  it('Pause stops the loop and transitions to paused; Resume restarts it', async () => {
    execClientMocks.pause.mockResolvedValue(undefined)
    execClientMocks.resume.mockResolvedValue(undefined)
    execClientMocks.tick.mockResolvedValue(completedDelta)
    setStatus('running', { activePlan: plan })
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(execClientMocks.pause).toHaveBeenCalledTimes(1))
    expect(useExecutionStore.getState().status).toBe('paused')

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(execClientMocks.resume).toHaveBeenCalledTimes(1))
    expect(useExecutionStore.getState().status).toBe('running')
  })

  it('Cancel calls cancel() and transitions to cancelled', async () => {
    execClientMocks.cancel.mockResolvedValue(undefined)
    setStatus('running', { activePlan: plan })
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(execClientMocks.cancel).toHaveBeenCalledTimes(1))
    expect(useExecutionStore.getState().status).toBe('cancelled')
  })

  it('Reset clears the session back to idle and drops the active plan', async () => {
    execClientMocks.reset.mockResolvedValue(undefined)
    setStatus('completed', { activePlan: plan })
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(execClientMocks.reset).toHaveBeenCalledTimes(1))
    const s = useExecutionStore.getState()
    expect(s.status).toBe('idle')
    expect(s.activePlan).toBeNull()
  })
})

describe('Progress and status display (execution-workspace spec)', () => {
  it('shows progress as a percentage and elapsed seconds while running', () => {
    setStatus('running', { progress: 0.5, elapsedSecs: 6.25 })
    renderWorkspace()
    expect(screen.getByText(/50%/)).toBeInTheDocument()
    expect(screen.getByText(/6\.3s/)).toBeInTheDocument()
  })

  it('surfaces the current execution status', () => {
    setStatus('paused', { activePlan: plan })
    renderWorkspace()
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('renders the code→CTA from describeError instead of the raw error message', () => {
    setStatus('failed', {
      error: { message: 'No plan', code: 'no_active_plan' },
    } as never)
    renderWorkspace()
    // error-ux spec: display the CTA from describeError, not the raw message
    expect(
      screen.getByText(/Preview a motion program in Programación first/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^No plan$/)).not.toBeInTheDocument()
  })
})

describe('Placeholder panels removed (visual audit V1)', () => {
  it('shows no Timeline or Telemetry placeholder panels', () => {
    setStatus('idle')
    renderWorkspace()
    expect(screen.queryByText(/Timeline visualization arrives with change 2/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Telemetry stream arrives with change 2/)).not.toBeInTheDocument()
  })
})

describe('Backend selector replaces the informational badge (execution-workspace spec)', () => {
  it('renders the interactive selector instead of the old source badge', () => {
    renderWorkspace()
    // The selector (Simulation/Hardware options) replaces the badge.
    expect(screen.getByRole('button', { name: /Simulation/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hardware/ })).toBeInTheDocument()
    expect(screen.queryByTestId('execution-source-badge')).not.toBeInTheDocument()
  })

  it('reflects the active backend from the store — Simulation selected, no port input', async () => {
    renderWorkspace()
    await waitFor(() => expect(useBackendStore.getState().activeId).toBe('simulation'))
    expect(screen.queryByLabelText('Puerto')).not.toBeInTheDocument()
  })
})

describe('Reconectar — reconnect + retry on connection_lost (execution-workspace spec)', () => {
  it('shows a Reconectar button (not Reintentar) when the tick fails with connection_lost', () => {
    setStatus('failed', {
      error: { message: 'Connection lost', code: 'connection_lost' },
    } as never)
    renderWorkspace()
    expect(screen.getByText(/Connection lost/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })

  it('Reconectar reconnects the hardware backend, then resets and starts execution', async () => {
    backendApiMocks.connect.mockResolvedValue({ status: 'ok' })
    backendApiMocks.list.mockResolvedValue([
      { ...SIM_BACKEND, status: 'inactive' },
      { ...ESP_BACKEND, status: 'active', connected: true },
    ])
    execClientMocks.reset.mockResolvedValue(undefined)
    execClientMocks.start.mockResolvedValue(undefined)
    execClientMocks.tick.mockResolvedValue(completedDelta)
    act(() => {
      useBackendStore.setState({ backends: [{ ...SIM_BACKEND, status: 'inactive' }, { ...ESP_BACKEND, status: 'active', connected: true }], activeId: 'esp32' })
    })
    setStatus('failed', {
      error: { message: 'Connection lost', code: 'connection_lost' },
      activePlan: plan,
    } as never)
    renderWorkspace()

    // The selector's fetch resolves; the active backend stays esp32.
    await waitFor(() => expect(useBackendStore.getState().activeId).toBe('esp32'))

    fireEvent.click(screen.getByRole('button', { name: 'Reconectar' }))

    // Reconnect with the active hardware backend's port, then reset+start.
    await waitFor(() => expect(backendApiMocks.connect).toHaveBeenCalledWith('esp32', '/dev/ttyUSB0'))
    await waitFor(() => expect(execClientMocks.reset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(execClientMocks.start).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useExecutionStore.getState().status).toBe('completed'))
  })
})

describe('Reintentar — reset+start retry on execution failure (resilience-matrix spec)', () => {
  it('shows the code→CTA error and a Reintentar button when a tick fails with network_error', () => {
    setStatus('failed', {
      error: { message: 'Backend is offline', code: 'network_error' },
    } as never)
    renderWorkspace()
    expect(screen.getByText(/Backend is offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('shows a Reintentar button for timeout_error', () => {
    setStatus('failed', {
      error: { message: 'Request timed out', code: 'timeout_error' },
    } as never)
    renderWorkspace()
    expect(screen.getByText(/Request timed out/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('clicking Reintentar performs the reset + start sequence', async () => {
    execClientMocks.reset.mockResolvedValue(undefined)
    execClientMocks.start.mockResolvedValue(undefined)
    execClientMocks.tick.mockResolvedValue(completedDelta)
    setStatus('failed', {
      error: { message: 'Backend is offline', code: 'network_error' },
      activePlan: plan,
    } as never)
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(execClientMocks.reset).toHaveBeenCalledTimes(1))
    // Coherent state: start() is triggered immediately after the reset and the
    // tick loop resumes — the plan runs to its terminal Completed state.
    await waitFor(() => expect(execClientMocks.start).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useExecutionStore.getState().status).toBe('completed'))
  })
})

describe('Conectar — connect+retry when start fails with not_connected (R3-001)', () => {
  it('a start failure with not_connected surfaces the error and a Conectar CTA (not a silent 200)', async () => {
    execClientMocks.start.mockRejectedValue(
      new ApiError('controller is not connected', { status: 409, code: 'not_connected' }),
    )
    setStatus('ready', { activePlan: plan })
    renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    // The backend 409 must NOT be read as 'running' — it lands in failed with
    // the machine-readable code preserved.
    await waitFor(() => expect(useExecutionStore.getState().status).toBe('failed'))
    expect(useExecutionStore.getState().error?.code).toBe('not_connected')
    // describeError renders the not_connected CTA + the Conectar button.
    expect(screen.getByText(/backend/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconectar' })).not.toBeInTheDocument()
  })

  it('Conectar reconnects the active hardware backend, then resets and starts', async () => {
    backendApiMocks.connect.mockResolvedValue({ status: 'ok' })
    backendApiMocks.list.mockResolvedValue([
      { ...SIM_BACKEND, status: 'inactive' },
      { ...ESP_BACKEND, status: 'active', connected: true },
    ])
    execClientMocks.reset.mockResolvedValue(undefined)
    execClientMocks.start.mockResolvedValue(undefined)
    execClientMocks.tick.mockResolvedValue(completedDelta)
    act(() => {
      useBackendStore.setState({
        backends: [
          { ...SIM_BACKEND, status: 'inactive' },
          { ...ESP_BACKEND, status: 'active', connected: true },
        ],
        activeId: 'esp32',
      })
    })
    setStatus('failed', {
      error: { message: 'controller is not connected', code: 'not_connected' },
      activePlan: plan,
    } as never)
    renderWorkspace()

    await waitFor(() => expect(useBackendStore.getState().activeId).toBe('esp32'))

    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    // Connect with the active hardware backend's port, then reset+start.
    await waitFor(() => expect(backendApiMocks.connect).toHaveBeenCalledWith('esp32', '/dev/ttyUSB0'))
    await waitFor(() => expect(execClientMocks.reset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(execClientMocks.start).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useExecutionStore.getState().status).toBe('completed'))
  })
})

describe('Execution mode selector (EW1/EW2)', () => {
  it('renders Once/Repeat and a bounded count input, hidden after a run starts', () => {
    setStatus('ready', { activePlan: plan })
    renderWorkspace()
    expect(screen.getByRole('button', { name: /Once/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Repeat/ })).toBeInTheDocument()
    // Count input appears only in Repeat mode.
    expect(screen.queryByLabelText('Repeat count')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Repeat/ }))
    expect(screen.getByLabelText('Repeat count')).toBeInTheDocument()
  })

  it('Start passes the selected mode to the client (repeat with count)', async () => {
    execClientMocks.start.mockResolvedValue(undefined)
    setStatus('ready', { activePlan: plan })
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /Repeat/ }))
    const input = screen.getByLabelText('Repeat count') as HTMLInputElement
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(execClientMocks.start).toHaveBeenCalledWith({ repeat: { count: 3 } }))
  })

  it('Start defaults to once when the mode stays Onces', async () => {
    execClientMocks.start.mockResolvedValue(undefined)
    setStatus('ready', { activePlan: plan })
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(execClientMocks.start).toHaveBeenCalledWith('once'))
  })
})

describe('Iteration badge (EW3-EW6)', () => {
  it('shows "Iteration i/N" while a Repeat session runs', () => {
    setStatus('running', { iteration: 2, totalIterations: 5, activePlan: plan })
    renderWorkspace()
    expect(screen.getByText(/Iteration/)).toBeInTheDocument()
    expect(screen.getByText('2 / 5')).toBeInTheDocument()
  })

  it('shows "Failed at i/N" when an iteration fails', () => {
    setStatus('failed', { iteration: 3, totalIterations: 5, activePlan: plan })
    renderWorkspace()
    expect(screen.getByText('Failed at 3 / 5')).toBeInTheDocument()
  })

  it('marks a completed repeat session as done', () => {
    setStatus('completed', { iteration: 5, totalIterations: 5, activePlan: plan })
    renderWorkspace()
    expect(screen.getByText('5 / 5 — Completed')).toBeInTheDocument()
  })

  it('hides the badge when total_iterations is absent (Once, EW6)', () => {
    setStatus('running', { iteration: 1, totalIterations: undefined, activePlan: plan })
    renderWorkspace()
    expect(screen.queryByText(/Iteration/)).not.toBeInTheDocument()
  })
})

describe('Execution origin pill (P0 visibility)', () => {
  it('shows Simulation by default', () => {
    setStatus('ready', { activePlan: plan, source: 'Simulation' })
    renderWorkspace()
    expect(screen.getByTestId('execution-source-pill')).toHaveTextContent('Simulation')
  })

  it('shows ESP32 · Connected when running on hardware with a live connection', () => {
    act(() => {
      useBackendStore.setState({ activeId: 'esp32' })
      useBackendStore.setState({ backends: [SIM_BACKEND, { ...ESP_BACKEND, status: 'active', connected: true }] })
    })
    setStatus('running', { activePlan: plan, source: 'Hardware' })
    renderWorkspace()
    expect(screen.getByTestId('execution-source-pill')).toHaveTextContent('ESP32 · Connected')
  })

  it('shows ESP32 · Disconnected when the hardware backend is not connected', () => {
    act(() => {
      useBackendStore.setState({ activeId: 'esp32' })
    })
    setStatus('running', { activePlan: plan, source: 'Hardware' })
    renderWorkspace()
    expect(screen.getByTestId('execution-source-pill')).toHaveTextContent('ESP32 · Disconnected')
  })
})

describe('Progress label (P1 clarity)', () => {
  it('labels the bar "Current progress" during a Repeat session', () => {
    setStatus('running', { activePlan: plan, progress: 0.62, iteration: 4, totalIterations: 10 })
    renderWorkspace()
    expect(screen.getByText(/Current progress 62%/)).toBeInTheDocument()
    expect(screen.getByText('4 / 10')).toBeInTheDocument()
  })

  it('labels the bar "Progress" for a Once session', () => {
    setStatus('running', { activePlan: plan, progress: 0.62, totalIterations: undefined })
    renderWorkspace()
    expect(screen.getByText(/Progress 62%/)).toBeInTheDocument()
    expect(screen.queryByText(/Current progress/)).not.toBeInTheDocument()
  })
})
