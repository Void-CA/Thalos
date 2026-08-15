// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { routerConfig, VIEW_REGISTRY } from '@/router'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { ServicesProvider } from '@/features/viewport/services/service-context'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * Integration tests for the navigation-router spec (slice 1).
 * The real Viewport renders a three.js <Canvas> (no WebGL under jsdom), so it
 * is replaced by a stub that counts mount/unmount — the persistence assertion
 * is: navigating must never unmount the viewport (invariant #1).
 *
 * Since slice 3 (guards) wraps every route in a GuardedRoute, these tests seed
 * the workflow stores so each route under test satisfies its registry
 * `requires` — the guards' OWN redirect behavior is covered in
 * `router.guards.test.tsx`. This file keeps asserting viewport persistence and
 * shell rendering, not guard semantics.
 */
const viewportMetrics = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))

vi.mock('@/features/viewport/viewport', async () => {
  const React = await import('react')
  return {
    Viewport: () => {
      React.useEffect(() => {
        viewportMetrics.mounts += 1
        return () => {
          viewportMetrics.unmounts += 1
        }
      }, [])
      return React.createElement('div', { 'data-testid': 'viewport-stub' })
    },
  }
})

// The visible /sessions area fetches GET /sessions on mount — stub the api so
// the router renders the list (or empty state) without real HTTP.
const sessionsApiMocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/sessions/api/session-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sessions/api/session-api')>()
  return { ...actual, sessionApi: sessionsApiMocks }
})

// The /demos workspace fetches the catalog on mount — stub it so the router
// renders the empty state without real HTTP (per-workspace behavior is covered
// in features/demos/workspace.test.tsx).
const demosApiMocks = vi.hoisted(() => ({ listDemos: vi.fn() }))
vi.mock('@/features/demos/api', () => demosApiMocks)

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const analysisReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.92,
    score: 92,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
}

/** Seed robot + compiled always; executable/completed/analyzed on demand. */
function seedPrerequisites(opts: {
  executable?: boolean
  completed?: boolean
  analyzed?: boolean
} = {}) {
  const executable = opts.executable ?? false
  const completed = opts.completed ?? false
  act(() => {
    useSceneStore.setState({ data: {} as SceneData })
    useSemanticEditor.setState({ result: compileResult, dirty: 0 })
    useExecutionStore.setState({
      status: completed ? 'completed' : executable ? 'ready' : 'idle',
    })
    useAnalysisStore.setState({ report: opts.analyzed ? analysisReport : null })
  })
}

function renderRouter(initialEntries: string[]) {
  const router = createMemoryRouter(routerConfig, { initialEntries })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <RouterProvider router={router} />
      </ServicesProvider>
    </QueryClientProvider>,
  )
  return { router, ...utils }
}

beforeEach(() => {
  viewportMetrics.mounts = 0
  viewportMetrics.unmounts = 0
  sessionsApiMocks.list.mockReset()
  demosApiMocks.listDemos.mockReset()
  demosApiMocks.listDemos.mockResolvedValue([])
  // Fresh workflow state per test (guards read these stores).
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ report: null })
})
afterEach(() => cleanup())

describe('layout route: persistent viewport (invariant #1)', () => {
  it('keeps the viewport mounted when navigating /task → /execution', async () => {
    seedPrerequisites({ executable: true }) // robotLoaded + compiled → guards pass
    const { router } = renderRouter(['/task'])

    // Full shell resolves at /task; viewport mounted exactly once.
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(1)
    // Stage navigation lives in the Stepper (the TopBar owns tool links only).
    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    expect(within(workflow).getByRole('button', { name: 'Programming' })).toHaveAttribute('aria-current', 'step')

    // URL-driven navigation via the Stepper stage.
    fireEvent.click(within(workflow).getByRole('button', { name: 'Execution' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))

    // Only the Outlet content changed; the viewport was never unmounted/remounted.
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
    expect(within(workflow).getByRole('button', { name: 'Execution' })).toHaveAttribute('aria-current', 'step')
    expect(viewportMetrics.mounts).toBe(1)
    expect(viewportMetrics.unmounts).toBe(0)
  })

  it('supports browser back/forward while the viewport persists', async () => {
    seedPrerequisites({ executable: true })
    const { router } = renderRouter(['/', '/task', '/execution'])

    expect(router.state.location.pathname).toBe('/execution')

    act(() => {
      router.navigate(-1)
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/task'))
    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    expect(within(workflow).getByRole('button', { name: 'Programming' })).toHaveAttribute('aria-current', 'step')
    expect(viewportMetrics.unmounts).toBe(0)

    act(() => {
      router.navigate(1)
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(1)
    expect(viewportMetrics.unmounts).toBe(0)
  })
})

describe('direct URL entry renders the full shell', () => {
  it('renders TopBar + Viewport + StatusBar + workspace panel at /execution', () => {
    seedPrerequisites({ executable: true })
    renderRouter(['/execution'])
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(screen.getByText('Thalos Robotics')).toBeInTheDocument() // StatusBar
    expect(screen.getByRole('link', { name: 'Demos' })).toBeInTheDocument() // TopBar tool link
  })
})

describe('hidden routes render placeholders (no 404)', () => {
  it.each([['/knowledge', 'Knowledge']])('renders a placeholder at %s (no 404)', (path, heading) => {
    seedPrerequisites({ analyzed: true })
    renderRouter([path])
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(screen.getByText('Thalos Robotics')).toBeInTheDocument()
  })

  it('renders the sessions list at /sessions (visible since S5, no 404)', async () => {
    seedPrerequisites({ completed: true })
    sessionsApiMocks.list.mockResolvedValue([])
    renderRouter(['/sessions'])
    // The browser's filter/search strip anchors the panel top (the redundant
    // "Sessions" heading was removed — the Stepper labels the stage).
    expect(screen.getByRole('searchbox', { name: /search/i })).toBeInTheDocument()
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
    // P0-A: /sessions is layout 'full' — the viewport is dropped so the data
    // table takes the whole body.
    expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
  })

  it('shows stage navigation in the Stepper (visible workspaces only — Knowledge hidden)', () => {
    renderRouter(['/'])
    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    expect(within(workflow).getByRole('button', { name: 'Programming' })).toBeInTheDocument()
    expect(within(workflow).getByRole('button', { name: 'Execution' })).toBeInTheDocument()
    expect(within(workflow).getByRole('button', { name: 'Sessions' })).toBeInTheDocument()
    expect(within(workflow).queryByRole('button', { name: 'Knowledge' })).not.toBeInTheDocument()
    // The TopBar carries only tool links (Demos), never stages.
    expect(screen.getByRole('link', { name: 'Demos' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Knowledge' })).not.toBeInTheDocument()
  })
})

describe('stepper — stages reflect guard state (the Stepper owns stage navigation)', () => {
  it('disables stages whose requirements are unmet (no navigation)', async () => {
    // Robot loaded (sceneValid=true) but NOT compiled → Execution (requires
    // executable) must be disabled; Sessions (guard relaxed) must not.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
      useSemanticEditor.setState({ result: null, dirty: 0 })
      useExecutionStore.setState({ status: 'idle' })
      useAnalysisStore.setState({ report: null })
    })
    const { router } = renderRouter(['/task'])
    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    const execution = within(workflow).getByRole('button', { name: 'Execution' })
    expect(execution).toBeDisabled()
    fireEvent.click(execution)
    expect(router.state.location.pathname).toBe('/task')
    expect(within(workflow).getByRole('button', { name: 'Sessions' })).toBeEnabled()
  })

  it('keeps stages enabled when their requirements are met', () => {
    seedPrerequisites({ executable: true })
    renderRouter(['/task'])
    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    expect(within(workflow).getByRole('button', { name: 'Execution' })).toBeEnabled()
    expect(within(workflow).getByRole('button', { name: 'Sessions' })).toBeEnabled()
  })
})

describe('the analysis check left the programming workspace (evaluation-workspace hotfix)', () => {
  it('task workspace has the three authoring tabs — no Analysis tab', () => {
    seedPrerequisites()
    renderRouter(['/task'])
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('tab', { name: 'Task' })).toBeInTheDocument()
    expect(main.getByRole('tab', { name: 'Motion' })).toBeInTheDocument()
    expect(main.getByRole('tab', { name: 'Code' })).toBeInTheDocument()
    expect(main.queryByRole('tab', { name: 'Analysis' })).not.toBeInTheDocument()
  })

  it('renders the Motion content under its tab (Task is the default)', () => {
    seedPrerequisites()
    renderRouter(['/task'])
    const main = within(screen.getByRole('main'))
    // The Task tab is the default — it renders the TaskEditor (compile seed
    // makes the header action "Send to Execution"; the Add action is stable).
    expect(main.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(main.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument()
    // The Motion + Trajectory Color sections live under their own tab.
    fireEvent.click(main.getByRole('tab', { name: 'Motion' }))
    expect(main.getByRole('heading', { name: 'Trajectory Color' })).toBeInTheDocument()
  })

  it('renders NO analysis content inside the programming workspace anymore', () => {
    seedPrerequisites({ analyzed: true })
    renderRouter(['/task'])
    const main = within(screen.getByRole('main'))
    expect(main.queryByText('No analysis available')).not.toBeInTheDocument()
    expect(
      main.queryByText(/Compile and preview a motion program to see analysis/),
    ).not.toBeInTheDocument()
  })
})

describe('the /evaluation route renders the pre-execution EVALUATION', () => {
  it('shows an Evaluation stage in the Stepper between Programming and Execution', () => {
    seedPrerequisites()
    renderRouter(['/task'])
    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    const programming = within(workflow).getByRole('button', { name: 'Programming' })
    const evaluation = within(workflow).getByRole('button', { name: 'Evaluation' })
    const execution = within(workflow).getByRole('button', { name: 'Execution' })
    // DOM order: Programming → Evaluation → Execution (contiguous stage order).
    expect(
      programming.compareDocumentPosition(evaluation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      evaluation.compareDocumentPosition(execution) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders /evaluation full-width WITHOUT the viewport (the decision is the focus)', () => {
    seedPrerequisites()
    renderRouter(['/evaluation'])
    expect(screen.getByRole('heading', { name: 'Evaluation' })).toBeInTheDocument()
    // layout 'full': the viewport is dropped so the decision owns the screen.
    expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
  })

  it('shows the empty state when the plan is not evaluated yet (analyzed=false)', () => {
    seedPrerequisites()
    renderRouter(['/evaluation'])
    expect(
      screen.getByText(/Evaluate the plan before executing/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Programming' })).toBeInTheDocument()
  })

  it('shows the evaluation content once the report exists (regions + clean verdict)', () => {
    seedPrerequisites({ analyzed: true })
    renderRouter(['/evaluation'])
    // The clean report has no problem regions → the "no problems" verdict.
    expect(screen.getByText(/No problems detected/i)).toBeInTheDocument()
  })

  it('unmounts the viewport on /evaluation and remounts it on return (documented invariant #1 exception)', async () => {
    seedPrerequisites({ executable: true })
    const { router } = renderRouter(['/task'])
    expect(viewportMetrics.mounts).toBe(1)

    const workflow = screen.getByRole('navigation', { name: 'Workflow' })
    fireEvent.click(within(workflow).getByRole('button', { name: 'Evaluation' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/evaluation'))
    expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
    expect(viewportMetrics.unmounts).toBe(1)

    // Back to Programming → the viewport returns (remounted fresh).
    act(() => {
      router.navigate('/task')
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/task'))
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(2)
  })
})

describe('Workspace Analysis lives in the Robot tools accordion (P0-B reorg)', () => {
  it('removes the /analysis route from the registry (clean removal — no redirect entry)', () => {
    seedPrerequisites()
    const { router } = renderRouter(['/analysis'])

    // The route is gone from the single source of truth: nothing registered at
    // /analysis (visiting it matches no route) and the top-bar shows no tool link.
    expect(WORKSPACE_REGISTRY.some((e) => e.path === '/analysis')).toBe(false)
    expect(screen.queryByRole('link', { name: 'Workspace Analysis' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analysis')
    expect(screen.queryByRole('button', { name: 'Run Analysis' })).not.toBeInTheDocument()
  })

  it('renders Workspace Analysis as an accordion tool inside the Robot shell at /', async () => {
    seedPrerequisites()
    const { router } = renderRouter(['/'])

    // All panels closed by default: the tool is reachable via its trigger.
    const trigger = screen.getByRole('button', { name: 'Workspace Analysis' })
    expect(screen.queryByRole('button', { name: /run analysis/i })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: /run analysis/i })).toBeInTheDocument())

    // Still inside the panel-layout Robot workspace — the viewport stays mounted.
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('router covers every registered workspace', () => {
  it('maps every registry workspace to a view in VIEW_REGISTRY', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      expect(VIEW_REGISTRY[entry.workspace]).toBeDefined()
    }
  })

  it('renders the Demos tool workspace at /demos (demos-workspace spec, kind tool route)', async () => {
    seedPrerequisites()
    renderRouter(['/demos'])
    expect(await screen.findByText(/No demos/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demos' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
  })

  it.each(WORKSPACE_REGISTRY.filter((e) => !e.hidden))(
    'renders $path ($workspace) with the shell and its active nav surface',
    (entry) => {
      // Sessions requires `completed` (status 'completed' — which makes
      // `executable` false), every other visible area needs `executable`.
      seedPrerequisites({ executable: true, completed: entry.workspace === 'sessions' })
      sessionsApiMocks.list.mockResolvedValue([])
      renderRouter([entry.path])
      // layout 'full' areas (evaluation) drop the viewport; all others render it.
      if (entry.layout === 'full') {
        expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
      } else {
        expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
      }
      // Stages mark the current step in the Stepper; tools mark the TopBar
      // link; a non-stage/non-tool area (Configuration) has no nav surface —
      // its own header is the identifier.
      if (entry.stage !== null) {
        const workflow = screen.getByRole('navigation', { name: 'Workflow' })
        expect(within(workflow).getByRole('button', { name: entry.label })).toHaveAttribute('aria-current', 'step')
      } else if (entry.kind === 'tool') {
        expect(screen.getByRole('link', { name: entry.label })).toHaveAttribute('aria-current', 'page')
      } else {
        expect(screen.getByRole('heading', { name: entry.label })).toBeInTheDocument()
      }
    },
  )
})
