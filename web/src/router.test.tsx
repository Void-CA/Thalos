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
  it('keeps the viewport mounted when navigating /task → /planning', async () => {
    seedPrerequisites() // robotLoaded + compiled → /task and /planning pass guards
    const { router } = renderRouter(['/task'])

    // Full shell resolves at /task; viewport mounted exactly once.
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(1)
    expect(screen.getByRole('link', { name: 'Programación' })).toHaveAttribute('aria-current', 'page')

    // URL-driven navigation via the TopBar nav link.
    fireEvent.click(screen.getByRole('link', { name: 'Planificación' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/planning'))

    // Only the Outlet content changed; the viewport was never unmounted/remounted.
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Planificación' })).toHaveAttribute('aria-current', 'page')
    expect(viewportMetrics.mounts).toBe(1)
    expect(viewportMetrics.unmounts).toBe(0)
  })

  it('supports browser back/forward while the viewport persists', async () => {
    seedPrerequisites()
    const { router } = renderRouter(['/', '/task', '/planning'])

    expect(router.state.location.pathname).toBe('/planning')

    act(() => {
      router.navigate(-1)
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/task'))
    expect(screen.getByRole('link', { name: 'Programación' })).toHaveAttribute('aria-current', 'page')
    expect(viewportMetrics.unmounts).toBe(0)

    act(() => {
      router.navigate(1)
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/planning'))
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
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
    // Robot loaded (sceneValid=true) but NOT compiled → Planning (requires
    // sceneValid) navigates; Execution (requires compiled) must not.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
      useSemanticEditor.setState({ result: null, dirty: 0 })
      useExecutionStore.setState({ status: 'idle' })
      useAnalysisStore.setState({ report: null })
    })
    const { router } = renderRouter(['/task'])
    const planningLink = screen.getByRole('link', { name: 'Planificación' })
    expect(planningLink).not.toHaveAttribute('aria-disabled')
    const executionLink = screen.getByRole('link', { name: 'Ejecución' })
    expect(executionLink).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(executionLink)
    expect(router.state.location.pathname).toBe('/task')
  })

  it('keeps links enabled when their requirements are met', () => {
    seedPrerequisites({ executable: true })
    renderRouter(['/task'])
    expect(screen.getByRole('link', { name: 'Planificación' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('link', { name: 'Ejecución' })).not.toHaveAttribute('aria-disabled')
  })
})

describe('analysis content lives inside planning (slice 6 — absorbed section)', () => {
  it('planning workspace has no "Analyze trajectory" cross-nav button', () => {
    seedPrerequisites()
    renderRouter(['/planning'])
    const main = within(screen.getByRole('main'))
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(main.queryByRole('button', { name: 'Analyze trajectory' })).not.toBeInTheDocument()
  })

  it('renders the analysis content under the Analysis tab (PR2 tabs layout)', () => {
    seedPrerequisites()
    renderRouter(['/planning'])
    const main = within(screen.getByRole('main'))
    // Motion Program tab is the default — its panel shows both sections.
    expect(main.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(main.getByRole('heading', { name: 'Trajectory Color' })).toBeInTheDocument()
    // The analysis content moved into the Analysis tab (workspace-analysis spec).
    fireEvent.click(main.getByRole('tab', { name: 'Analysis' }))
    expect(main.getByRole('heading', { name: 'Analysis' })).toBeInTheDocument()
  })

  it('shows the simple empty state when nothing is analyzed yet (no cross-nav)', () => {
    seedPrerequisites()
    renderRouter(['/planning'])
    const main = within(screen.getByRole('main'))
    fireEvent.click(main.getByRole('tab', { name: 'Analysis' }))
    expect(main.getByText('Compile and preview a motion program to see analysis')).toBeInTheDocument()
    expect(main.queryByRole('button', { name: 'Planning' })).not.toBeInTheDocument()
  })

  it('renders StatusBanner + problem regions + optimization inside planning when analyzed', () => {
    seedPrerequisites({ analyzed: true })
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...analysisReport,
          problem_regions: [
            {
              id: 7,
              kind: 'singularity',
              severity: 'critical',
              waypoint_start: 10,
              waypoint_end: 20,
              waypoint_count: 11,
              explanation: {
                cause: 'Singularity near waypoint 10',
                consequence: 'Tool flips near the goal',
                recommended_strategies: ['Joint centering'],
                confidence: 0.9,
              },
            },
          ],
        },
      })
    })
    renderRouter(['/planning'])
    const main = within(screen.getByRole('main'))
    fireEvent.click(main.getByRole('tab', { name: 'Analysis' }))
    expect(main.getByText('Good')).toBeInTheDocument() // StatusBanner state label
    expect(main.getByText('92 / 100')).toBeInTheDocument() // StatusBanner score
    expect(
      main.getByRole('button', { name: /Singularity near waypoint 10/i }),
    ).toBeInTheDocument() // ProblemRegions region card
    expect(main.getByRole('button', { name: 'Optimize Trajectory' })).toBeInTheDocument() // OptimizationPanel
  })

  it('keeps intra-workspace region drill-down within planning (URL unchanged)', () => {
    seedPrerequisites({ analyzed: true })
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...analysisReport,
          problem_regions: [
            {
              id: 7,
              kind: 'singularity',
              severity: 'critical',
              waypoint_start: 10,
              waypoint_end: 20,
              waypoint_count: 11,
              explanation: {
                cause: 'Singularity near waypoint 10',
                consequence: 'Tool flips near the goal',
                recommended_strategies: ['Joint centering'],
                confidence: 0.9,
              },
            },
          ],
        },
      })
    })
    const { router } = renderRouter(['/planning'])
    const main = within(screen.getByRole('main'))
    fireEvent.click(main.getByRole('tab', { name: 'Analysis' }))

    // Drill down: click the region card → Region Details inspector opens.
    fireEvent.click(main.getByRole('button', { name: /Singularity near waypoint 10/i }))
    expect(main.getByRole('heading', { name: 'Region Details' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/planning')

    // Back control: close the inspector → overview returns, still on /planning.
    fireEvent.click(main.getByRole('button', { name: '' }))
    expect(main.queryByRole('heading', { name: 'Region Details' })).not.toBeInTheDocument()
    expect(
      main.getByRole('button', { name: /Singularity near waypoint 10/i }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/planning')
  })
})

describe('the /analysis route renders the AnalysisWorkspace tool (PR-D — kind nav model)', () => {
  it('shows an Analysis link in the top-bar tools group', () => {
    seedPrerequisites()
    renderRouter(['/planning'])
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
    'renders $path ($workspace) with the full shell and an active nav link',
    (entry) => {
      // Sessions requires `completed` (status 'completed' — which makes
      // `executable` false), every other visible area needs `executable`.
      seedPrerequisites({ executable: true, completed: entry.workspace === 'sessions' })
      sessionsApiMocks.list.mockResolvedValue([])
      renderRouter([entry.path])
      expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: entry.label })).toHaveAttribute('aria-current', 'page')
    },
  )
})
