// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { ExecutionWorkspace } from './execution-workspace'
import { useExecutionStore } from './execution-store'
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
  useExecutionStore.setState({
    status: 'idle',
    activePlan: null,
    progress: 0,
    elapsedSecs: 0,
    error: null,
  })
  act(() => {
    useSceneStore.setState({ execution: null } as never)
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
      screen.getByText(/Preview a motion program in Planificación first/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^No plan$/)).not.toBeInTheDocument()
  })
})

describe('Backend source badge (execution-workspace spec, ADDED)', () => {
  function setRuntimeExecutionSource(source: string) {
    act(() => {
      useSceneStore.setState({
        execution: {
          status: 'running',
          progress: 0.5,
          elapsedSecs: 6.25,
          source,
        },
      } as never)
    })
  }

  it('shows a Simulation badge when the runtime reports execution.source = Simulation', () => {
    setRuntimeExecutionSource('Simulation')
    renderWorkspace()
    expect(screen.getByText('Simulation')).toBeInTheDocument()
  })

  it('shows a Hardware badge when the runtime reports execution.source = Hardware', () => {
    setRuntimeExecutionSource('Hardware')
    renderWorkspace()
    expect(screen.getByText('Hardware')).toBeInTheDocument()
  })

  it('shows no source badge when execution has no source', () => {
    setStatus('idle')
    renderWorkspace()
    expect(screen.queryByText('Simulation')).not.toBeInTheDocument()
    expect(screen.queryByText('Hardware')).not.toBeInTheDocument()
  })
})
