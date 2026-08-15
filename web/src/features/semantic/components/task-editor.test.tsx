// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { routerConfig } from '@/router'
import { ServicesProvider } from '@/features/viewport/services/service-context'
import { TaskEditor } from './task-editor'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useDomainSceneStore } from '@/features/scene/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * Behavior tests for the frontend-task-workspace spec (slice 4, task 4.1) and
 * the program-dual-editor spec (Unified Compile/Send Button):
 *
 * - Task purity: the Task workspace renders ZERO execution controls (no
 *   Simulate/Stop, no progress/elapsed footers) — execution lives in Execution.
 * - Unified Compile/Send button: ONE header action derives label + handler from
 *   `compiled` ("Compile" green → "Send to Execution" purple), disabled without
 *   `canCompile`; the footer Send button is removed; the payload is identical
 *   for both actions (program-dual-editor spec "Unified Compile/Send Button").
 * - Send-to-Execution handoff: `executeSemantic` (never `start()`), navigates
 *   to /execution and leaves execStatus = 'ready' with the tick loop NOT
 *   running (execution-workspace spec, Invariant #5).
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

/** Scene read + plan analysis — the compile preview path (hotfix
 *  unify-programming) consumes both after a successful compile. */
const previewMocks = vi.hoisted(() => ({
  getScene: vi.fn(),
  analyze: vi.fn(),
}))

vi.mock('@/features/viewport/api/scene-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewport/api/scene-api')>()
  return { ...actual, sceneApi: { ...actual.sceneApi, getScene: previewMocks.getScene } }
})

vi.mock('@/features/analysis/api/plan-analysis-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/analysis/api/plan-analysis-api')>()
  return { ...actual, planAnalysisApi: { ...actual.planAnalysisApi, analyze: previewMocks.analyze } }
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

/** Full scene state after the compiled Task plan is scheduled into the
 *  runtime — what `getScene()` returns on the compile-preview path. */
const sceneWithPlan: RuntimeStateResponse = {
  robot: { id: 'r1', display_name: 'R1', dof: 2, joints: [] },
  joints: [0, 0],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: {
    plan_id: 'plan-1',
    state: 'Ready',
    motion_type: 'PTP',
    trajectory_progress: null,
    visualization: {
      motion_type: 'PTP',
      waypoints: [
        { position: [0, 0, 0], orientation: [0, 0, 0, 1], joints: [0, 0], timestamp: 0, waypoint_type: 'Start' },
        { position: [1, 0, 0], orientation: [0, 0, 0, 1], joints: [0.5, 0.5], timestamp: 2.5, waypoint_type: 'Goal' },
      ],
    },
    segments: null,
    created_at: '2026-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
  },
  active_tcp: null,
  execution: null,
  generated_at: '2026-01-01T00:00:00Z',
}

const analysisReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.9,
    score: 90,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
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

/** Direct render of the TaskEditor — the unit-test entry for text-mode
 *  behaviors. The workspace's Code tab mounts exactly
 *  `<TaskEditor initialMode="text" />`; `renderEditor('text')` is the
 *  focused equivalent without the workspace shell. */
function renderEditor(initialMode?: 'visual' | 'text') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <MemoryRouter>
          <TaskEditor initialMode={initialMode} />
        </MemoryRouter>
      </ServicesProvider>
    </QueryClientProvider>,
  )
}

/** Seed robotLoaded + a compiled (or stale) program — the guards pass for /task. */
function seedTask(opts: { compiled?: boolean; dirty?: number } = {}) {
  const { compiled = false, dirty = 0 } = opts
  act(() => {
    useSceneStore.setState({ data: {} as SceneData })
    useSemanticEditor.setState({ result: compiled ? compileResult : null, dirty })
  })
}

/** Operation-row comboboxes = editable row controls. RobotSelector — the only
 *  aria-labeled combobox ("Task robot") — was removed (product-quality PR1), so
 *  every combobox in the Task workspace is a row control; queryAll* keeps the
 *  "zero rows in text mode" assertion meaningful instead of throwing. */
const rowComboboxes = () => screen.queryAllByRole('combobox')

const textarea = () =>
  screen.getByTestId('program-textarea') as HTMLTextAreaElement

beforeEach(() => {
  apiMocks.executeSemantic.mockClear()
  apiMocks.compileSemantic.mockClear()
  previewMocks.getScene.mockReset()
  previewMocks.analyze.mockReset()
  execClientMocks.start.mockClear()
  execClientMocks.pause.mockClear()
  execClientMocks.resume.mockClear()
  execClientMocks.cancel.mockClear()
  execClientMocks.reset.mockClear()
  execClientMocks.tick.mockClear()
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle', activePlan: null })
  useAnalysisStore.setState({ report: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('Task purity — zero execution controls in Task (frontend-task-workspace spec)', () => {
  it('renders no Simulate/Stop buttons and no execution progress footers', async () => {
    seedTask({ compiled: true })
    renderRouter(['/task'])

    // The Program panel renders with authoring controls — the unified
    // Compile/Send header button (with a compiled plan it reads "Send to
    // Execution"; either label proves the authoring surface rendered).
    expect(await screen.findByRole('button', { name: /Compile|Send to Execution/ })).toBeInTheDocument()

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

describe('Unified Compile/Send button (program-dual-editor spec)', () => {
  it('1.1 — header shows "Compile" for valid un-compiled ops and compiles the task document', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    seedTask() // no result → compiled = false
    renderRouter(['/task'])

    const compile = await screen.findByRole('button', { name: 'Compile' })
    expect(compile).toBeEnabled()
    // Unified button: no separate Send control exists anywhere.
    expect(screen.queryByRole('button', { name: /Send to Execution/ })).not.toBeInTheDocument()

    fireEvent.click(compile)

    await waitFor(() => expect(apiMocks.compileSemantic).toHaveBeenCalledTimes(1))
    expect(apiMocks.compileSemantic).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          scene: expect.objectContaining({ objects: expect.any(Array) }),
          program: expect.objectContaining({ operations: expect.any(Array) }),
        }),
      }),
    )
    expect(useSemanticEditor.getState().result).toEqual(compileResult)
    expect(useSemanticEditor.getState().dirty).toBe(0)
  })

  it('1.1b — disables the unified button when the program cannot compile (!canCompile)', async () => {
    seedTask()
    act(() => {
      useSemanticEditor.setState({ operations: [] })
    })
    renderRouter(['/task'])

    const compile = await screen.findByRole('button', { name: 'Compile' })
    expect(compile).toBeDisabled()
  })

  it('1.2 — relabels to "Send to Execution" when compiled && dirty=0 and sends the SAME payload', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    apiMocks.executeSemantic.mockResolvedValue(executeResponse)
    seedTask() // compiled = false
    const router = renderRouter(['/task'])

    // Compile via the unified button and capture the exact payload sent.
    fireEvent.click(await screen.findByRole('button', { name: 'Compile' }))
    await waitFor(() => expect(apiMocks.compileSemantic).toHaveBeenCalledTimes(1))
    const compilePayload = apiMocks.compileSemantic.mock.calls[0][0]

    // The SAME button reads "Send to Execution" — no "Compile" label remains.
    const send = await screen.findByRole('button', { name: /Send to Execution/ })
    expect(send).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Compile' })).not.toBeInTheDocument()

    fireEvent.click(send)

    // executeSemantic fires TWICE: once for the compile preview (hotfix
    // unify-programming — load the plan so the viewport draws it), once for
    // the handoff. Payload identity (spec): the LAST call (the handoff) sends
    // exactly what compile sent.
    await waitFor(() => expect(apiMocks.executeSemantic).toHaveBeenCalledTimes(2))
    expect(apiMocks.executeSemantic).toHaveBeenLastCalledWith(compilePayload)
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))
  })

  it('1.3 — dirty > 0 after compile reverts the button to "Compile" (compiled=false)', async () => {
    seedTask({ compiled: true, dirty: 1 }) // result set but dirty → compiled = false
    renderRouter(['/task'])

    expect(await screen.findByRole('button', { name: 'Compile' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Send to Execution/ })).not.toBeInTheDocument()
  })

  it('1.4 — footer holds no Compile/Send action: a single unified header button exists', async () => {
    seedTask({ compiled: true })
    renderRouter(['/task'])

    const actions = within(screen.getByRole('main'))
      .getAllByRole('button')
      .filter((b) => /Compile|Send to Execution/.test(b.textContent ?? ''))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toHaveTextContent(/Send to Execution/)
  })
})

describe('Send to Execution handoff (execution-workspace spec, Invariant #5)', () => {

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

describe('Task compile previews the plan — trajectory + analysis (hotfix unify-programming)', () => {
  it('draws the compiled Task plan (applyScene with activePlan) and fires the analysis', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    apiMocks.executeSemantic.mockResolvedValue(executeResponse)
    previewMocks.getScene.mockResolvedValue(sceneWithPlan)
    previewMocks.analyze.mockResolvedValue(analysisReport)
    seedTask()
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('button', { name: /Compile/ }))

    // Compile still stores the result (unchanged contract)…
    await waitFor(() => expect(apiMocks.compileSemantic).toHaveBeenCalledTimes(1))
    expect(useSemanticEditor.getState().result).toEqual(compileResult)

    // …and the compiled plan is applied to the scene store — the viewport
    // draws its trajectory (the Motion-tab preview pattern, now on Tasks).
    await waitFor(() => expect(useSceneStore.getState().activePlan).not.toBeNull())
    expect(useSceneStore.getState().activePlan?.planId).toBe('plan-1')
    expect(useSceneStore.getState().activePlan?.visualization?.waypoints).toHaveLength(2)

    // The plan analysis fired and populated the Analysis tab report.
    expect(previewMocks.analyze).toHaveBeenCalledTimes(1)
    expect(useAnalysisStore.getState().report).toEqual(analysisReport)
  })

  it('keeps the compile result when the plan/analysis preview fails (non-blocking)', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    apiMocks.executeSemantic.mockRejectedValue(new Error('preview failed'))
    seedTask()
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('button', { name: /Compile/ }))

    // The compile result stands — the preview failure never blocks it.
    await waitFor(() => expect(apiMocks.compileSemantic).toHaveBeenCalledTimes(1))
    expect(useSemanticEditor.getState().result).toEqual(compileResult)
    expect(useSceneStore.getState().activePlan).toBeNull()
    expect(useAnalysisStore.getState().report).toBeNull()
    // The failure surfaces as an error (DiagnosticsPanel) without navigating.
    await waitFor(() => expect(screen.getByText(/preview failed/i)).toBeInTheDocument())
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

describe('Code tab — editable text mode with atomic commit (S2)', () => {
  /** The store's canonical sample program serialized by `serialize` (P7). */
  const SAMPLE_TEXT = 'pick bolt-1\nwait 1s\nplace bolt-1 at tray-1\nhome'

  it('defaults to Visual mode (Task tab) with editable rows and no text surface', () => {
    seedTask()
    renderEditor()

    expect(rowComboboxes().length).toBeGreaterThan(0)
    expect(screen.queryByTestId('program-textarea')).not.toBeInTheDocument()
  })

  it('enters text mode (Code tab) with an editable textarea holding canonical text', () => {
    seedTask()
    renderEditor('text')

    // Single editable surface (spec "Text mode editable, Visual read-only"):
    // the textarea holds EXACTLY serialize(operations) — the canonical form —
    // and the operation rows are hidden.
    expect(textarea().tagName).toBe('TEXTAREA')
    expect(textarea().value).toBe(SAMPLE_TEXT)
    expect(rowComboboxes()).toHaveLength(0)
  })

  it('typing into the buffer never touches the store (R3 buffer/model separation)', () => {
    seedTask()
    renderEditor('text')
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\n' } })

    // Buffer advanced locally; the store program + dirty are byte-identical.
    expect(textarea().value).toBe('pick bolt-1\n')
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('Apply with valid text commits the WHOLE program in one atomic replace (I5)', () => {
    seedTask()
    renderEditor('text')
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    // ONE write: the full parsed set replaced the sample program, dirty +1.
    expect(useSemanticEditor.getState().operations).toEqual([
      { type: 'pick', origin: 'pick-1', object: 'bolt-1', tool: undefined },
      { type: 'wait', origin: 'wait-2', duration: { secs: 2, nanos: 0 } },
      { type: 'home', origin: 'home-3' },
    ])
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore + 1)
  })

  it('Apply with invalid text shows inline errors and performs ZERO program writes (R2)', () => {
    seedTask()
    renderEditor('text')
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\njump 10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    // Inline per-line errors under the textarea (line 2 = the failing line).
    const alerts = screen.getAllByRole('alert')
    expect(alerts.some((a) => a.textContent?.includes('line 2'))).toBe(true)
    expect(alerts.some((a) => a.textContent?.includes("unknown command 'jump'"))).toBe(true)

    // Atomicity (R2): NOTHING in the program state changed — no partial
    // replacement of the sample program, dirty untouched.
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('parse errors also surface in the DiagnosticsPanel summary (I5)', async () => {
    seedTask()
    renderRouter(['/task'])
    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }))
    fireEvent.change(await screen.findByTestId('program-textarea'), {
      target: { value: 'pick bolt-1\nwait forever' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const diagnostics = screen.getByRole('region', { name: 'Diagnostics' })
    expect(diagnostics.textContent).toContain('line 2')
    expect(diagnostics.textContent).toContain("invalid duration 'forever'")
  })

  it('switching Code<->Task tabs never mutates the store (model intact)', async () => {
    seedTask()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }))
    expect(await screen.findByTestId('program-textarea')).toBeInTheDocument()
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)

    fireEvent.click(screen.getByRole('tab', { name: 'Task' }))
    expect(screen.queryByTestId('program-textarea')).not.toBeInTheDocument()
    expect(rowComboboxes().length).toBeGreaterThan(0)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    expect(await screen.findByTestId('program-textarea')).toBeInTheDocument()
    expect(textarea().value).toBe(SAMPLE_TEXT)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })
})

describe('S3.1 — leaving Code with an uncommitted buffer never corrupts the store (I6, P5)', () => {
  it('discards the uncommitted buffer on tab switch WITHOUT committing (model intact)', async () => {
    seedTask()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }))
    fireEvent.change(await screen.findByTestId('program-textarea'), {
      target: { value: 'pick bolt-1\nwait 2s\nhome' },
    })

    // The tab-switch guard (task-code-sync-guards spec) warns first; the user
    // confirms the discard — the uncommitted buffer is dropped and NEVER
    // written: no partial replace, no dirty bump, no silent commit.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Task' }))
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Uncommitted changes will be lost'))
    expect(screen.queryByTestId('program-textarea')).not.toBeInTheDocument()
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('returning to Code re-serializes the canonical store text (fresh buffer)', async () => {
    seedTask()
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }))
    fireEvent.change(await screen.findByTestId('program-textarea'), {
      target: { value: 'pick bolt-1\nwait 2s\nhome' },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Task' }))

    // Re-entry re-serializes serialize(operations): the discarded buffer is
    // gone, the canonical text is back — text can never drift from the model.
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    expect(await screen.findByTestId('program-textarea')).toBeInTheDocument()
    expect(
      (screen.getByTestId('program-textarea') as HTMLTextAreaElement).value,
    ).toBe('pick bolt-1\nwait 1s\nplace bolt-1 at tray-1\nhome')
  })

  it('switching tabs with a clean buffer behaves identically (no data at risk)', async () => {
    seedTask()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('tab', { name: 'Code' }))
    await screen.findByTestId('program-textarea')
    const confirmSpy = vi.spyOn(window, 'confirm')
    fireEvent.click(screen.getByRole('tab', { name: 'Task' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })
})

describe('S3.3 — external store change does not silently overwrite a dirty buffer', () => {
  it('warns when the program changed outside the editor while the buffer is dirty', () => {
    seedTask()
    renderEditor('text')
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    // External change (e.g. a visual edit elsewhere / a program mutation that
    // is not this buffer's Apply): store.operations is replaced out-of-band.
    act(() => {
      useSemanticEditor.getState().replaceOperations([
        { type: 'pick', origin: 'ext-1', object: 'bolt-1' },
      ])
    })

    // Indicator appears; the buffer is NOT overwritten; the store holds the
    // external change — no silent overwrite in either direction.
    expect(screen.getByText(/changed outside the editor/i)).toBeInTheDocument()
    expect(textarea().value).toBe('pick bolt-1\nwait 2s\nhome')
    expect(useSemanticEditor.getState().operations).toEqual([
      { type: 'pick', origin: 'ext-1', object: 'bolt-1' },
    ])
  })

  it('shows no warning while the store is unchanged', () => {
    seedTask()
    renderEditor('text')
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    // User typed only — the store never moved, so no sync indicator.
    expect(screen.queryByText(/changed outside the editor/i)).not.toBeInTheDocument()
  })
})

describe('S3.3 — Apply disabled while parse errors are present', () => {
  it('disables Apply for an invalid buffer and re-enables once fixed', () => {
    seedTask()
    renderEditor('text')

    // Clean canonical buffer → Apply enabled.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()

    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\njump 10' } })

    // Parse errors present → Apply disabled + inline errors shown.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)

    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s' } })

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Sync guards — Apply disabled on external change + buffer divergence (program-dual-editor spec)', () => {
  it('disables Apply when the store changed externally AND the buffer diverges', () => {
    seedTask()
    renderEditor('text')
    // Buffer diverges from the store (user typed).
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })
    // External change (e.g. a visual-row edit / scene mutation elsewhere):
    // the store program is replaced out-of-band.
    act(() => {
      useSemanticEditor.getState().replaceOperations([
        { type: 'pick', origin: 'ext-1', object: 'bolt-1' },
      ])
    })

    // Hard guard: a stale buffer must NOT overwrite the external change.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    // The tooltip explains the resolution path (spec "commit or discard").
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveAttribute(
      'title',
      expect.stringMatching(/commit or discard/i) as unknown as string,
    )
  })

  it('keeps Apply enabled when typing in text mode (no external change)', () => {
    seedTask()
    renderEditor('text')
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    // Buffer diverges but the store never moved externally — the user is
    // actively editing, so Apply stays enabled (spec "Guards Do Not Block
    // Valid Workflows").
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })

  it('re-enables Apply when the buffer matches the external change', () => {
    seedTask()
    renderEditor('text')
    // External change first: the store program is replaced out-of-band.
    act(() => {
      useSemanticEditor.getState().replaceOperations([
        { type: 'pick', origin: 'ext-1', object: 'bolt-1' },
      ])
    })
    // The user syncs the buffer to the new store text — buffer now matches
    // serialize(operations), so no divergence remains.
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1' } })

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })
})

describe('Sync guards — Run advisory on uncommitted buffer (task-code-sync-guards spec)', () => {
  it('Run with a divergent buffer confirms first; cancel blocks the action', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    apiMocks.executeSemantic.mockResolvedValue(executeResponse)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    seedTask()
    renderEditor('text')
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }))

    // Advisory shown; declining means the compile never fires and the buffer
    // stays untouched.
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('last compiled version'),
    )
    expect(apiMocks.compileSemantic).not.toHaveBeenCalled()
    expect(textarea().value).toBe('pick bolt-1\nwait 2s\nhome')
  })

  it('Run with a committed buffer proceeds without any dialog', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    apiMocks.executeSemantic.mockResolvedValue(executeResponse)
    const confirmSpy = vi.spyOn(window, 'confirm')
    seedTask()
    renderEditor('text')

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(apiMocks.compileSemantic).toHaveBeenCalledTimes(1))
  })
})

describe('Sync guards — hasUncommittedBuffer store flag (task-code-sync-guards spec)', () => {
  it('lifts divergence to the store flag: set on typing, cleared on Apply', () => {
    seedTask()
    renderEditor('text')
    expect(useSemanticEditor.getState().hasUncommittedBuffer).toBe(false)

    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    expect(useSemanticEditor.getState().hasUncommittedBuffer).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(useSemanticEditor.getState().hasUncommittedBuffer).toBe(false)
  })
})

describe('S3.5 — editor help in Text mode', () => {
  it('renders the canonical grammar, an example and the canonical-text note in Text mode', () => {
    seedTask()
    renderEditor('text')

    // Grammar summary: all 5 ops + at + tool= + duration forms + comments.
    const help = within(screen.getByTestId('script-help'))
    expect(help.getByText('pick <object> [tool=<name>]')).toBeInTheDocument()
    expect(help.getByText('place <object> at <location> [tool=<name>]')).toBeInTheDocument()
    expect(help.getByText('move_to <location> [tool=<name>]')).toBeInTheDocument()
    expect(help.getByText(/wait <duration>/)).toBeInTheDocument()
    expect(help.getByText('home')).toBeInTheDocument()

    // A brief worked example + the explicit canonical-representation contract.
    expect(help.getByText(/pick bolt-1/)).toBeInTheDocument()
    expect(help.getByText(/canonical representation/i)).toBeInTheDocument()
    expect(help.getByText(/not preserved/i)).toBeInTheDocument()
  })

  it('is hidden in Visual mode', () => {
    seedTask()
    renderEditor()

    expect(screen.queryByText('pick <object> [tool=<name>]')).not.toBeInTheDocument()
  })
})

describe('TaskEditor toolbar — grouped command bar (R7/R8/R10)', () => {
  it('R7/R10 — buttons live in three separated groups (Program | File I/O | Execution)', () => {
    seedTask()
    renderEditor()
    // Two visible separators divide the three command groups.
    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(2)
    // Every button belongs to its group container.
    expect(screen.getByRole('button', { name: 'Add' }).closest('[data-group="program"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Reset' }).closest('[data-group="program"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Load Program' }).closest('[data-group="file-io"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save Program' }).closest('[data-group="file-io"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Compile' }).closest('[data-group="execution"]')).not.toBeNull()
  })

  it('R8 — Save Program and Compile carry visible text labels (never icon-only)', () => {
    seedTask()
    renderEditor()
    expect(screen.getByRole('button', { name: 'Save Program' })).toHaveTextContent('Save Program')
    expect(screen.getByRole('button', { name: 'Compile' })).toHaveTextContent('Compile')
  })

  it('R8 — the compiled state keeps a visible text label on the unified action ("Send to Execution")', async () => {
    apiMocks.compileSemantic.mockResolvedValue(compileResult)
    seedTask()
    renderRouter(['/task'])
    fireEvent.click(await screen.findByRole('button', { name: 'Compile' }))
    const send = await screen.findByRole('button', { name: /Send to Execution/ })
    expect(send).toHaveTextContent('Send to Execution')
    expect(send).toHaveAttribute('data-weight', 'primary')
  })
})

describe('TaskEditor toolbar — button weight hierarchy (R9)', () => {
  it('R9 — Add normal, Reset secondary, Load/Save secondary, Compile primary', () => {
    seedTask()
    renderEditor()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('data-weight', 'normal')
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveAttribute('data-weight', 'secondary')
    expect(screen.getByRole('button', { name: 'Load Program' })).toHaveAttribute('data-weight', 'secondary')
    expect(screen.getByRole('button', { name: 'Save Program' })).toHaveAttribute('data-weight', 'secondary')
    expect(screen.getByRole('button', { name: 'Compile' })).toHaveAttribute('data-weight', 'primary')
  })
})

describe('TaskEditor toolbar — keyboard reachability (R12)', () => {
  it('R12 — toolbar buttons are tab-reachable in logical group order, each with an accessible name', () => {
    seedTask()
    renderEditor()
    // Accessible names prove ARIA labels: every critical button resolves by
    // role + name (a missing/empty label would throw here).
    const expected = ['Add', 'Reset', 'Load Program', 'Save Program', 'Compile']
    const buttons = screen.getAllByRole('button')
    const order = buttons.map((b) => b.textContent?.trim() ?? '')
    const positions = expected.map((name) => order.indexOf(name))
    // All buttons exist…
    expect(positions.every((p) => p >= 0)).toBe(true)
    // …and appear in the logical Program → File I/O → Execution order.
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

describe('TaskEditor — Load Program / Save Program / unified execution action (D12/D13)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('[Load Program] parses a .thalos file and replaces operations; scene untouched', async () => {
    seedTask()
    renderEditor()
    const sceneBefore = JSON.stringify(useDomainSceneStore.getState().objects)

    const input = screen.getByLabelText('Load program file') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [new File(['pick box-1\nplace box-1 at tray-1\nhome'], 'program.thalos', { type: 'text/plain' })],
      },
    })

    await waitFor(() => expect(useSemanticEditor.getState().operations).toHaveLength(3))
    expect(useSemanticEditor.getState().operations.map((o) => o.type)).toEqual(['pick', 'place', 'home'])
    expect(useSemanticEditor.getState().operations[1]).toMatchObject({ object: 'box-1', destination: 'tray-1' })
    // Load Program ≠ Load Scene: the domain scene store never moved.
    expect(JSON.stringify(useDomainSceneStore.getState().objects)).toBe(sceneBefore)
  })

  it('[Load Program] invalid text surfaces the parse error and mutates NOTHING (R2)', async () => {
    seedTask()
    renderEditor()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    const input = screen.getByLabelText('Load program file') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['pick bolt-1\njump 10'], 'bad.thalos', { type: 'text/plain' })] },
    })

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unknown command 'jump'/)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('[Save Program] downloads canonical .thalos text — not JSON (spec "Save persists text")', async () => {
    seedTask()
    renderEditor()
    let captured: Blob | null = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'Save Program' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(await captured!.text()).toBe('pick bolt-1\nwait 1s\nplace bolt-1 at tray-1\nhome')
  })

  it('the toolbar exposes NO standalone Run button — the unified Compile/Send is the only execution action', () => {
    seedTask()
    renderEditor()
    // Reorganization: the one-shot Run shortcut was removed from the Task
    // toolbar. Compile already previews the plan and Send to Execution
    // executes + navigates, so the unified action covers the run flow
    // without a duplicate primary button (Demos keeps its own Run).
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compile' })).toBeInTheDocument()
  })
})
