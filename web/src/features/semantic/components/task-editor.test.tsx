// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { routerConfig } from '@/router'
import { ServicesProvider } from '@/features/viewport/services/service-context'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'

/**
 * Behavior tests for the frontend-task-workspace spec (slice 4, task 4.1):
 *
 * - Task purity: the Task workspace renders ZERO execution controls (no
 *   Simulate/Stop, no progress/elapsed footers) — execution lives in Execution.
 * - Send-to-Execution handoff: `executeSemantic` (never `start()`), disabled
 *   until compiled, navigates to /execution and leaves execStatus = 'ready'
 *   with the tick loop NOT running (execution-workspace spec, Invariant #5).
 * - Task keeps its authoring responsibility: operations + compile still work.
 */

const apiMocks = vi.hoisted(() => ({
  executeSemantic: vi.fn(),
  compileSemantic: vi.fn(),
}))

vi.mock('@/features/semantic/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/semantic/api')>()
  return { ...actual, executeSemantic: apiMocks.executeSemantic, compileSemantic: apiMocks.compileSemantic }
})

/** The tick loop is owned by the Execution workspace — assert it never fires from Task. */
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

// The real Viewport renders a three.js <Canvas> (no WebGL under jsdom) — stub it.
vi.mock('@/features/viewport/viewport', async () => {
  const React = await import('react')
  return {
    Viewport: () => React.createElement('div', { 'data-testid': 'viewport-stub' }),
  }
})

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const executeResponse = {
  status: 'ok',
  segment_count: 4,
  duration_secs: 12.5,
  waypoints: [],
  event_count: 3,
}

function renderRouter(initialEntries: string[]) {
  const router = createMemoryRouter(routerConfig, { initialEntries })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <RouterProvider router={router} />
      </ServicesProvider>
    </QueryClientProvider>,
  )
  return router
}

/** Seed robotLoaded + a compiled (or stale) program — the guards pass for /task. */
function seedTask(opts: { compiled?: boolean; dirty?: number } = {}) {
  const { compiled = false, dirty = 0 } = opts
  act(() => {
    useSceneStore.setState({ data: {} as SceneData })
    useSemanticEditor.setState({ result: compiled ? compileResult : null, dirty })
  })
}

beforeEach(() => {
  apiMocks.executeSemantic.mockClear()
  apiMocks.compileSemantic.mockClear()
  execClientMocks.start.mockClear()
  execClientMocks.pause.mockClear()
  execClientMocks.resume.mockClear()
  execClientMocks.cancel.mockClear()
  execClientMocks.reset.mockClear()
  execClientMocks.tick.mockClear()
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle', activePlan: null })
})
afterEach(() => cleanup())

describe('Task purity — zero execution controls in Task (frontend-task-workspace spec)', () => {
  it('renders no Simulate/Stop buttons and no execution progress footers', async () => {
    seedTask({ compiled: true })
    renderRouter(['/task'])

    // The Program panel renders with authoring controls…
    expect(await screen.findByRole('button', { name: /Compile/ })).toBeInTheDocument()

    // …but zero execution UI elements exist anywhere in the Task workspace.
    // Scoped to the workspace panel (<main>): the shell's global stepper is a
    // separate surface and legitimately shows workflow reasons like "Requires a
    // completed execution" — it is not an execution control inside Task.
    const workspace = within(screen.getByRole('main'))
    expect(workspace.queryByRole('button', { name: /Simulate/i })).not.toBeInTheDocument()
    expect(workspace.queryByRole('button', { name: /Stop/i })).not.toBeInTheDocument()
    expect(workspace.queryByText(/Executing/i)).not.toBeInTheDocument()
    expect(workspace.queryByText(/Completed/i)).not.toBeInTheDocument()
    expect(workspace.queryByText(/elapsed/i)).not.toBeInTheDocument()
  })
})

describe('Send to Execution handoff (execution-workspace spec, Invariant #5)', () => {
  it('is disabled with a "Compile first" hint while the program is not compiled', async () => {
    seedTask() // no result → compiled = false
    renderRouter(['/task'])

    const send = await screen.findByRole('button', { name: /Send to Execution/ })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('title', 'Compile first')
  })

  it('re-disables after an edit invalidates the compile (dirty > 0)', async () => {
    seedTask({ compiled: true, dirty: 1 }) // result set but dirty → compiled = false
    renderRouter(['/task'])

    const send = await screen.findByRole('button', { name: /Send to Execution/ })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('title', 'Compile first')
  })

  it('calls executeSemantic without start(), loads the plan as ready, navigates to /execution and never starts the tick', async () => {
    apiMocks.executeSemantic.mockResolvedValue(executeResponse)
    seedTask({ compiled: true })
    const router = renderRouter(['/task'])

    const send = await screen.findByRole('button', { name: /Send to Execution/ })
    expect(send).toBeEnabled()

    fireEvent.click(send)

    // POST /semantic/execute fires with the TaskDocument (scene + program)…
    await waitFor(() => expect(apiMocks.executeSemantic).toHaveBeenCalledTimes(1))
    expect(apiMocks.executeSemantic).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          scene: expect.objectContaining({ objects: expect.any(Array) }),
          program: expect.objectContaining({ operations: expect.any(Array) }),
        }),
      }),
    )

    // …the router lands on /execution with the plan loaded (ready, not running).
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))

    const exec = useExecutionStore.getState()
    expect(exec.status).toBe('ready')
    expect(exec.activePlan).toEqual({
      instructionCount: 4,
      durationSecs: 12.5,
      source: 'TaskDocument',
    })

    // The tick loop is EXCLUSIVE to Execution: never triggered from Task.
    expect(execClientMocks.start).not.toHaveBeenCalled()
    expect(execClientMocks.tick).not.toHaveBeenCalled()
  })

  it('surfaces a handoff error without navigating', async () => {
    apiMocks.executeSemantic.mockResolvedValue({ ...executeResponse, status: 'error' })
    seedTask({ compiled: true })
    const router = renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('button', { name: /Send to Execution/ }))

    await waitFor(() =>
      expect(screen.getByText(/Execution handoff failed/i)).toBeInTheDocument(),
    )
    expect(router.state.location.pathname).toBe('/task')
    expect(useExecutionStore.getState().status).toBe('idle')
  })
})

describe('Task stays an authoring workspace (compile still works)', () => {
  it('compiles the program via compileSemantic and stores the result', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    seedTask()
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('button', { name: /Compile/ }))

    await waitFor(() => expect(apiMocks.compileSemantic).toHaveBeenCalledTimes(1))
    expect(useSemanticEditor.getState().result).toEqual(compileResult)
    expect(useSemanticEditor.getState().dirty).toBe(0)
  })
})
