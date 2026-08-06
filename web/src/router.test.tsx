// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { routerConfig, VIEW_REGISTRY } from '@/router'
import { WORKSPACE_REGISTRY, producerOf } from '@/shared/workflow/registry'
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
    expect(screen.getByRole('link', { name: 'Programación' })).toHaveAttribute('aria-current', 'page')

    // URL-driven navigation via the TopBar nav link.
    fireEvent.click(screen.getByRole('link', { name: 'Ejecución' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))

    // Only the Outlet content changed; the viewport was never unmounted/remounted.
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ejecución' })).toHaveAttribute('aria-current', 'page')
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
    expect(screen.getByRole('link', { name: 'Programación' })).toHaveAttribute('aria-current', 'page')
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
    expect(screen.getByRole('link', { name: 'Programación' })).toBeInTheDocument() // TopBar nav
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
    expect(screen.getByRole('heading', { name: 'Sesiones' })).toBeInTheDocument()
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
  })

  it('shows nav links for visible workspaces only (Sesiones visible, Knowledge hidden)', () => {
    renderRouter(['/'])
    expect(screen.getByRole('link', { name: 'Programación' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ejecución' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sesiones' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Knowledge' })).not.toBeInTheDocument()
  })
})

describe('top-bar — nav links reflect guard state (slice 5, task 5.2)', () => {
  it('disables links whose requirements are unmet (aria-disabled, no navigation)', async () => {
    // Robot loaded (sceneValid=true) but NOT compiled → Execution (requires
    // executable) must not navigate; Sesiones (guard relaxed) must.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
      useSemanticEditor.setState({ result: null, dirty: 0 })
      useExecutionStore.setState({ status: 'idle' })
      useAnalysisStore.setState({ report: null })
    })
    const { router } = renderRouter(['/task'])
    const executionLink = screen.getByRole('link', { name: 'Ejecución' })
    expect(executionLink).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(executionLink)
    expect(router.state.location.pathname).toBe('/task')
    const sessionsLink = screen.getByRole('link', { name: 'Sesiones' })
    expect(sessionsLink).not.toHaveAttribute('aria-disabled')
  })

  it('keeps links enabled when their requirements are met', () => {
    seedPrerequisites({ executable: true })
    renderRouter(['/task'])
    expect(screen.getByRole('link', { name: 'Ejecución' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('link', { name: 'Sesiones' })).not.toHaveAttribute('aria-disabled')
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

describe('the /evaluation route renders the pre-execution EVALUACIÓN', () => {
  it('shows an Evaluación link in the top-bar between Programación and Ejecución', () => {
    seedPrerequisites()
    renderRouter(['/task'])
    const links = screen.getAllByRole('link').map((l) => l.textContent?.trim() ?? '')
    const idx = (name: string) => links.indexOf(name)
    expect(idx('Programación')).toBeGreaterThanOrEqual(0)
    expect(idx('Evaluación')).toBe(idx('Programación') + 1)
    expect(idx('Ejecución')).toBe(idx('Evaluación') + 1)
  })

  it('renders /evaluation full-width WITHOUT the viewport (the decision is the focus)', () => {
    seedPrerequisites()
    renderRouter(['/evaluation'])
    expect(screen.getByRole('heading', { name: 'Evaluación' })).toBeInTheDocument()
    // layout 'full': the viewport is dropped so the decision owns the screen.
    expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
  })

  it('shows the empty state when the plan is not evaluated yet (analyzed=false)', () => {
    seedPrerequisites()
    renderRouter(['/evaluation'])
    expect(
      screen.getByText(/Evaluá el plan antes de ejecutar/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a Programación' })).toBeInTheDocument()
  })

  it('shows the evaluation content once the report exists (regions + clean verdict)', () => {
    seedPrerequisites({ analyzed: true })
    renderRouter(['/evaluation'])
    // The clean report has no problem regions → the "no problems" verdict.
    expect(screen.getByText(/No se detectaron problemas/i)).toBeInTheDocument()
  })

  it('unmounts the viewport on /evaluation and remounts it on return (documented invariant #1 exception)', async () => {
    seedPrerequisites({ executable: true })
    const { router } = renderRouter(['/task'])
    expect(viewportMetrics.mounts).toBe(1)

    fireEvent.click(screen.getByRole('link', { name: 'Evaluación' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/evaluation'))
    expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
    expect(viewportMetrics.unmounts).toBe(1)

    // Back to Programación → the viewport returns (remounted fresh).
    act(() => {
      router.navigate('/task')
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/task'))
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(2)
  })
})

describe('the /analysis route renders the AnalysisWorkspace tool (PR-D — kind nav model)', () => {
  it('shows an Analysis link in the top-bar tools group', () => {
    seedPrerequisites()
    renderRouter(['/task'])
    expect(screen.getByRole('link', { name: 'Analysis' })).toBeInTheDocument()
  })

  it('routes /analysis to the AnalysisWorkspace when a robot is loaded (no modal)', () => {
    seedPrerequisites()
    const { router } = renderRouter(['/analysis'])

    // No redirect: the route is registered (navigation-router "Analysis route
    // registered"). The inline workspace renders its config + explicit trigger.
    expect(router.state.location.pathname).toBe('/analysis')
    expect(screen.getByRole('button', { name: 'Run Analysis' })).toBeInTheDocument()
    expect(screen.getByText('No data yet — run the analysis')).toBeInTheDocument()
  })

  it('redirects /analysis to the root when no robot is loaded (requires robotLoaded)', async () => {
    act(() => {
      useSceneStore.setState({ data: null })
      useSemanticEditor.setState({ result: null, dirty: 0 })
      useExecutionStore.setState({ status: 'idle' })
      useAnalysisStore.setState({ report: null })
    })
    const { router } = renderRouter(['/analysis'])

    expect(producerOf('robotLoaded')?.path).toBe('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('router covers every registered workspace', () => {
  it('maps every registry workspace to a view in VIEW_REGISTRY', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      expect(VIEW_REGISTRY[entry.workspace]).toBeDefined()
    }
  })

  it.each(WORKSPACE_REGISTRY.filter((e) => !e.hidden))(
    'renders $path ($workspace) with the shell and an active nav link',
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
      expect(screen.getByRole('link', { name: entry.label })).toHaveAttribute('aria-current', 'page')
    },
  )
})
