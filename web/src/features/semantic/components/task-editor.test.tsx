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

/** Operation-row comboboxes = editable row controls. The workspace-header
 *  robot selector (aria-label="Task robot") stays regardless of mode, so
 *  scope the "rows hidden" assertion to the row selects only. */
const rowComboboxes = () =>
  screen.getAllByRole('combobox').filter((cb) => !cb.hasAttribute('aria-label'))

const textarea = () =>
  screen.getByTestId('program-textarea') as HTMLTextAreaElement

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

    await waitFor(() => expect(apiMocks.executeSemantic).toHaveBeenCalledTimes(1))
    // Payload identity (spec): execute sends exactly what compile sent.
    expect(apiMocks.executeSemantic).toHaveBeenCalledWith(compilePayload)
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

describe('Program panel Visual/Text toggle — editable text mode with atomic commit (S2)', () => {
  /** The store's canonical sample program serialized by `serialize` (P7). */
  const SAMPLE_TEXT = 'pick bolt-1\nwait 1s\nplace bolt-1 at tray-1\nhome'

  it('defaults to Visual mode with editable rows; Text toggles to an editable textarea with canonical text', async () => {
    seedTask()
    renderRouter(['/task'])

    // Visual mode is default: editable rows render, no text surface yet.
    expect(await screen.findByRole('button', { name: 'Text' })).toBeInTheDocument()
    expect(rowComboboxes().length).toBeGreaterThan(0)
    expect(screen.queryByTestId('program-textarea')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Text' }))

    // Single editable surface (spec "Text mode editable, Visual read-only"):
    // the textarea holds EXACTLY serialize(operations) — the canonical form —
    // and the operation rows are hidden.
    expect(textarea().tagName).toBe('TEXTAREA')
    expect(textarea().value).toBe(SAMPLE_TEXT)
    expect(rowComboboxes()).toHaveLength(0)
  })

  it('typing into the buffer never touches the store (R3 buffer/model separation)', async () => {
    seedTask()
    renderRouter(['/task'])
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\n' } })

    // Buffer advanced locally; the store program + dirty are byte-identical.
    expect(textarea().value).toBe('pick bolt-1\n')
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('Apply with valid text commits the WHOLE program in one atomic replace (I5)', async () => {
    seedTask()
    renderRouter(['/task'])
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
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

  it('Apply with invalid text shows inline errors and performs ZERO program writes (R2)', async () => {
    seedTask()
    renderRouter(['/task'])
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait forever' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const diagnostics = screen.getByRole('region', { name: 'Diagnostics' })
    expect(diagnostics.textContent).toContain('line 2')
    expect(diagnostics.textContent).toContain("invalid duration 'forever'")
  })

  it('repeated Visual<->Text toggles never mutate the store (model intact)', async () => {
    seedTask()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)

    fireEvent.click(screen.getByRole('button', { name: 'Visual' }))
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)

    // Rows are back in Visual mode — the same single editable surface.
    expect(rowComboboxes().length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })
})

describe('S3.1 — dirty guard: Text→Visual with uncommitted buffer (I6, P5)', () => {
  const enterTextMode = async () => {
    renderRouter(['/task'])
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
  }

  it('shows the confirm dialog when switching Text→Visual with a dirty buffer', async () => {
    seedTask()
    await enterTextMode()
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    fireEvent.click(screen.getByRole('button', { name: 'Visual' }))

    // I6: warning SHALL appear "Uncommitted changes will be lost" and the
    // user SHALL confirm or cancel — the switch is NOT performed yet.
    expect(await screen.findByRole('dialog')).toHaveTextContent('Uncommitted changes will be lost')
    expect(screen.getByTestId('program-textarea')).toBeInTheDocument()
  })

  it('cancel keeps the buffer, stays in Text mode and touches nothing', async () => {
    seedTask()
    await enterTextMode()
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.click(screen.getByRole('button', { name: 'Visual' }))
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/i }))

    // Cancel → remain in Text mode, buffer intact, store byte-identical.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(textarea().value).toBe('pick bolt-1\nwait 2s\nhome')
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('confirm discards the buffer and switches to Visual without committing', async () => {
    seedTask()
    await enterTextMode()
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    fireEvent.click(screen.getByRole('button', { name: 'Visual' }))
    fireEvent.click(await screen.findByRole('button', { name: /Discard changes/i }))

    // Confirm → buffer discarded (NOT committed), rows are back in Visual.
    expect(screen.queryByTestId('program-textarea')).not.toBeInTheDocument()
    expect(rowComboboxes().length).toBeGreaterThan(0)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('switches silently when the buffer is clean (no dialog)', async () => {
    seedTask()
    await enterTextMode()

    fireEvent.click(screen.getByRole('button', { name: 'Visual' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(rowComboboxes().length).toBeGreaterThan(0)
  })
})

describe('S3.3 — external store change does not silently overwrite a dirty buffer', () => {
  it('warns when the program changed outside the editor while the buffer is dirty', async () => {
    seedTask()
    renderRouter(['/task'])
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
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

  it('shows no warning while the store is unchanged', async () => {
    seedTask()
    renderRouter(['/task'])
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))
    fireEvent.change(textarea(), { target: { value: 'pick bolt-1\nwait 2s\nhome' } })

    // User typed only — the store never moved, so no sync indicator.
    expect(screen.queryByText(/changed outside the editor/i)).not.toBeInTheDocument()
  })
})

describe('S3.3 — Apply disabled while parse errors are present', () => {
  it('disables Apply for an invalid buffer and re-enables once fixed', async () => {
    seedTask()
    renderRouter(['/task'])
    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))

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

describe('S3.5 — editor help in Text mode', () => {
  it('renders the canonical grammar, an example and the canonical-text note in Text mode', async () => {
    seedTask()
    renderRouter(['/task'])

    fireEvent.click(await screen.findByRole('button', { name: 'Text' }))

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

  it('is hidden in Visual mode', async () => {
    seedTask()
    renderRouter(['/task'])

    expect(screen.queryByText('pick <object> [tool=<name>]')).not.toBeInTheDocument()
  })
})
