// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { routerConfig } from '@/router'
import { producerOf } from '@/shared/workflow/registry'
import { ServicesProvider } from '@/features/viewport/services/service-context'
import { useSceneStore } from '@/features/viewport/store'
import { useDomainSceneStore } from '@/features/scene/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData, ActivePlan } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * Behavior tests for the workflow-guards spec (slice 3): GuardedRoute must
 * redirect to the workspace that PRODUCES the missing flag (per the registry),
 * never to a hardcoded ad-hoc path. Assertions are observable: the final
 * rendered workspace and the redirect target, both derived from the registry
 * via producerOf() — not from internal guard implementation.
 */

// The real Viewport renders a three.js <Canvas> (no WebGL under jsdom) — stub
// it exactly like the slice-1 router tests so the full shell still renders.
vi.mock('@/features/viewport/viewport', async () => {
  const React = await import('react')
  return {
    Viewport: () => React.createElement('div', { 'data-testid': 'viewport-stub' }),
  }
})

// /sessions renders the SessionBrowser (guard relaxed since S5) — stub the api
// so the workspace mounts without real HTTP (data assertions live in the
// session-browser tests; here we only assert guard/navigation behavior).
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
  summary: { quality_index: 0.92, score: 92, grade: 'Good', observation_count: 0, severity_distribution: {} },
}

/** Seed the real stores to a given workflow state (act-wrapped, observable). */
function seedWorkflowState(opts: {
  robotLoaded?: boolean
  compiled?: boolean
  executable?: boolean
  completed?: boolean
  analyzed?: boolean
  /** PR2: planning-preview path — an active plan present in the scene store
   *  unlocks planReady even without a compiled Task plan. */
  activePlan?: boolean
} = {}) {
  const {
    robotLoaded = false,
    compiled = false,
    executable = false,
    completed = false,
    analyzed = false,
    activePlan = false,
  } = opts
  act(() => {
    useSceneStore.setState({
      data: robotLoaded ? ({} as SceneData) : null,
      activePlan: activePlan ? ({ planId: 'plan-1', state: 'ready', motionType: 'PTP', trajectoryProgress: null, visualization: null, createdAt: '2026-01-01T00:00:00Z', startedAt: null, completedAt: null } as ActivePlan) : null,
    })
    useSemanticEditor.setState({
      result: compiled ? compileResult : null,
      dirty: 0,
    })
    useExecutionStore.setState({
      status: completed ? 'completed' : executable ? 'ready' : 'idle',
    })
    useAnalysisStore.setState({ report: analyzed ? analysisReport : null })
  })
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

beforeEach(() => {
  // Fresh stores per test (all flags false). The domain scene store has no
  // reset action, so restore the canonical seed (1 bolt) explicitly — tests
  // that clear objects must not leak into later tests.
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useDomainSceneStore.setState({
    objects: [{ id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } }],
  })
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ report: null })
  sessionsApiMocks.list.mockReset()
})
afterEach(() => cleanup())

describe('GuardedRoute — behavior over real router routes', () => {
  it('chains to the root when the producer itself is blocked (no robot loaded)', async () => {
    // robotLoaded=false → /scene is also blocked → its producer (Robot '/') is
    // the chain terminal → the guard chain lands on the root.
    seedWorkflowState({})
    const router = renderRouter(['/task'])

    expect(producerOf('robotLoaded')?.path).toBe('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.getByRole('heading', { name: 'Robots' })).toBeInTheDocument()
  })

  it('blocks /task without a valid scene, redirecting to the producer of sceneValid', async () => {
    // sceneValid=false (objects cleared) but robot loaded → /task requires
    // sceneValid → redirect to the Escena area (produces sceneValid).
    seedWorkflowState({ robotLoaded: true })
    act(() => {
      useDomainSceneStore.setState({ objects: [] })
    })
    const router = renderRouter(['/task'])

    const producer = producerOf('sceneValid')
    expect(producer?.path).toBe('/scene')
    await waitFor(() => expect(router.state.location.pathname).toBe(producer!.path))

    // Escena panel renders (SceneEditor content); Programación does not.
    expect(screen.getByText('Objects')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Program' })).not.toBeInTheDocument()
  })

  it('renders /task with the Motion Program tab when the scene is valid, even without a compiled plan', async () => {
    // sceneValid=true (default seed), compiled=false → /task renders: the
    // Motion Program is built from the scene (/scene/preview), not from the
    // Task-compiled plan — compiled state SHALL NOT affect access. This is the
    // D2 rule the old /planning carried, now inside the unified workspace.
    seedWorkflowState({ robotLoaded: true })
    const router = renderRouter(['/task'])

    expect(router.state.location.pathname).toBe('/task')
    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }))
    expect(screen.getByRole('heading', { name: 'Trajectory Color' })).toBeInTheDocument()
  })

  it('blocks /execution when planReady=false (no compiled plan, no preview), redirecting to /task', async () => {
    // PR2 (workflow-guards spec "No plan at all redirects to Task"): the gate
    // is ['sceneValid','planReady','executable'] — with NO plan at all
    // (compiled=false AND no activePlan in the scene store) planReady=false and
    // the guard redirects to /task, the producer of planReady's origin
    // (compiled), instead of the root.
    seedWorkflowState({ robotLoaded: true })
    const router = renderRouter(['/execution'])

    const producer = producerOf('planReady')
    expect(producer?.path).toBe('/task')
    await waitFor(() => expect(router.state.location.pathname).toBe(producer!.path))

    // Execution panel must NOT render; Programación workspace is active.
    expect(screen.queryByRole('heading', { name: 'Execution' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Program' })).toBeInTheDocument()
  })

  it('renders /execution from a planning-preview plan (planReady without compiled)', async () => {
    // PR2 (motion-program spec "Execution can start from Motion Program plan"):
    // the planning preview wrote an activePlan into the scene store →
    // planReady=true even though `compiled` is false → the guard ALLOWS access
    // and the Start button is enabled (execStatus = ready).
    seedWorkflowState({ robotLoaded: true, activePlan: true, executable: true })
    const router = renderRouter(['/execution'])

    expect(router.state.location.pathname).toBe('/execution')
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('blocks /execution without an executable plan, redirecting to the producer', async () => {
    // executable=false (compiled but no status ready/running/paused) → no producer → root.
    seedWorkflowState({ robotLoaded: true, compiled: true })
    const router = renderRouter(['/execution'])

    expect(producerOf('executable')).toBeUndefined()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.getByRole('heading', { name: 'Robots' })).toBeInTheDocument()
  })

  it('renders /execution when the plan is executable', async () => {
    seedWorkflowState({ robotLoaded: true, compiled: true, executable: true })
    const router = renderRouter(['/execution'])

    expect(router.state.location.pathname).toBe('/execution')
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
  })

  it('renders /sessions directly without a completed execution (guard relaxed)', async () => {
    // S5.1 AUDIT verdict (area-sessions spec): `completed` was removed from
    // sessions.requires — the guard SHALL NOT redirect when completed=false,
    // so failed/running sessions are browsable. completed=false here.
    seedWorkflowState({ robotLoaded: true, compiled: true, executable: true })
    sessionsApiMocks.list.mockResolvedValue([])
    const router = renderRouter(['/sessions'])

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions'))
    expect(screen.getByRole('heading', { name: 'Sesiones' })).toBeInTheDocument()
  })

  it('renders /knowledge once the plan is analyzed', async () => {
    seedWorkflowState({ robotLoaded: true, compiled: true, analyzed: true })
    const router = renderRouter(['/knowledge'])

    expect(router.state.location.pathname).toBe('/knowledge')
    expect(screen.getByRole('heading', { name: 'Knowledge' })).toBeInTheDocument()
  })

  it('renders the /configuration shell with no 404 (non-stage area, area-configuration spec)', async () => {
    // Configuración requires nothing — no workflow seed needed.
    seedWorkflowState({})
    const router = renderRouter(['/configuration'])

    await waitFor(() => expect(router.state.location.pathname).toBe('/configuration'))
    expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument()
    expect(screen.getByText(/Settings coming soon/i)).toBeInTheDocument()
  })
})
