// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
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
import type { SceneData } from '@/features/viewport/types'
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
} = {}) {
  const {
    robotLoaded = false,
    compiled = false,
    executable = false,
    completed = false,
    analyzed = false,
  } = opts
  act(() => {
    useSceneStore.setState({ data: robotLoaded ? ({} as SceneData) : null })
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
})
afterEach(() => cleanup())

describe('GuardedRoute — behavior over real router routes', () => {
  it('blocks /planning without a compiled plan, redirecting to the producer of compiled', async () => {
    seedWorkflowState({ robotLoaded: true }) // compiled=false, robot loaded
    const router = renderRouter(['/planning'])

    // Registry is the source of truth for the redirect target.
    const producer = producerOf('compiled')
    expect(producer?.path).toBe('/task')
    await waitFor(() => expect(router.state.location.pathname).toBe(producer!.path))

    // Planning panel must NOT render; Programación workspace is active.
    expect(screen.queryByRole('heading', { name: 'Motion Program' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Programación' })).toHaveAttribute('aria-current', 'page')
  })

  it('chains to the root when the producer itself is blocked (no robot loaded)', async () => {
    // robotLoaded=false → /scene is also blocked → its producer (Robot '/') is
    // the chain terminal → the guard chain lands on the root.
    seedWorkflowState({})
    const router = renderRouter(['/planning'])

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

  it('renders /planning normally when the plan is compiled', async () => {
    seedWorkflowState({ robotLoaded: true, compiled: true })
    const router = renderRouter(['/planning'])

    expect(router.state.location.pathname).toBe('/planning')
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
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

  it('redirects direct /sessions entry to the producer of completed', async () => {
    // completed=false, executable=true → redirect to producerOf('completed') = /execution.
    seedWorkflowState({ robotLoaded: true, compiled: true, executable: true })
    const router = renderRouter(['/sessions'])

    const producer = producerOf('completed')
    expect(producer?.path).toBe('/execution')
    await waitFor(() => expect(router.state.location.pathname).toBe(producer!.path))
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
  })

  it('renders /knowledge once the plan is analyzed', async () => {
    seedWorkflowState({ robotLoaded: true, compiled: true, analyzed: true })
    const router = renderRouter(['/knowledge'])

    expect(router.state.location.pathname).toBe('/knowledge')
    expect(screen.getByRole('heading', { name: 'Knowledge' })).toBeInTheDocument()
  })
})
