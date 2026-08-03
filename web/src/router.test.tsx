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
import type { PlanAnalysisResponse } from '@/features/analysis/api/plan-analysis.types'

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

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const analysisSummary: PlanAnalysisResponse['summary'] = {
  status: 'ok',
  score: 92,
  grade: 'Good',
  message: 'ok',
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
    useAnalysisStore.setState({ summary: opts.analyzed ? analysisSummary : null })
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
  // Fresh workflow state per test (guards read these stores).
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ summary: null })
})
afterEach(() => cleanup())

describe('layout route: persistent viewport (invariant #1)', () => {
  it('keeps the viewport mounted when navigating /task → /planning', async () => {
    seedPrerequisites() // robotLoaded + compiled → /task and /planning pass guards
    const { router } = renderRouter(['/task'])

    // Full shell resolves at /task; viewport mounted exactly once.
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(1)
    expect(screen.getByRole('link', { name: 'Task' })).toHaveAttribute('aria-current', 'page')

    // URL-driven navigation via the TopBar nav link.
    fireEvent.click(screen.getByRole('link', { name: 'Planning' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/planning'))

    // Only the Outlet content changed; the viewport was never unmounted/remounted.
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Planning' })).toHaveAttribute('aria-current', 'page')
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
    expect(screen.getByRole('link', { name: 'Task' })).toHaveAttribute('aria-current', 'page')
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
    expect(screen.getByRole('link', { name: 'Task' })).toBeInTheDocument() // TopBar nav
  })
})

describe('hidden routes render placeholders (no 404)', () => {
  it.each([
    ['/sessions', 'Sessions'],
    ['/knowledge', 'Knowledge'],
  ])('renders a placeholder at %s (no 404)', (path, heading) => {
    seedPrerequisites({ completed: true, analyzed: true })
    renderRouter([path])
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(screen.getByText('Thalos Robotics')).toBeInTheDocument()
  })

  it('does not show nav links for hidden workspaces', () => {
    renderRouter(['/'])
    expect(screen.getByRole('link', { name: 'Task' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Execution' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Knowledge' })).not.toBeInTheDocument()
  })
})

describe('top-bar — nav links reflect guard state (slice 5, task 5.2)', () => {
  it('disables links whose requirements are unmet (aria-disabled, no navigation)', async () => {
    // Robot loaded but NOT compiled → Planning (requires compiled) must not navigate.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
      useSemanticEditor.setState({ result: null, dirty: 0 })
      useExecutionStore.setState({ status: 'idle' })
      useAnalysisStore.setState({ summary: null })
    })
    const { router } = renderRouter(['/task'])
    const planningLink = screen.getByRole('link', { name: 'Planning' })
    expect(planningLink).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(planningLink)
    expect(router.state.location.pathname).toBe('/task')
  })

  it('keeps links enabled when their requirements are met', () => {
    seedPrerequisites({ executable: true })
    renderRouter(['/task'])
    expect(screen.getByRole('link', { name: 'Planning' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('link', { name: 'Execution' })).not.toHaveAttribute('aria-disabled')
  })
})

describe('cross-navigation converges in stepper + top-bar (slice 5, task 5.2)', () => {
  it('planning workspace has no "Analyze trajectory" cross-nav button', () => {
    seedPrerequisites()
    renderRouter(['/planning'])
    const main = within(screen.getByRole('main'))
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(main.queryByRole('button', { name: 'Analyze trajectory' })).not.toBeInTheDocument()
  })

  it('analysis workspace has no back-to-planning breadcrumb button', () => {
    seedPrerequisites()
    renderRouter(['/analysis'])
    const main = within(screen.getByRole('main'))
    expect(main.getByText('No plan compiled')).toBeInTheDocument()
    expect(main.queryByRole('button', { name: 'Planning' })).not.toBeInTheDocument()
  })

  it('analysis remains reachable through registry-driven navigation (top-bar link)', async () => {
    seedPrerequisites()
    const { router } = renderRouter(['/planning'])
    fireEvent.click(screen.getByRole('link', { name: 'Analysis' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analysis'))
    expect(screen.getByText('No plan compiled')).toBeInTheDocument()
  })

  it('analysis keeps its intra-workspace region drill-down back control', async () => {
    seedPrerequisites({ analyzed: true })
    act(() => {
      useAnalysisStore.setState({
        problemRegions: [
          {
            id: 7,
            kind: 'singularity',
            severity: 'warning',
            waypoint_start: 10,
            waypoint_end: 20,
            waypoint_count: 11,
          },
        ],
        selectedRegionId: 7,
      })
    })
    const { router } = renderRouter(['/analysis'])
    const main = within(screen.getByRole('main'))
    expect(main.getByRole('heading', { name: 'Region Details' })).toBeInTheDocument()

    // Intra-workspace drill-down: URL unchanged, no cross-workspace navigation.
    fireEvent.click(main.getByRole('button', { name: 'Analysis' }))
    expect(router.state.location.pathname).toBe('/analysis')
    expect(main.queryByRole('heading', { name: 'Region Details' })).not.toBeInTheDocument()
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
      seedPrerequisites({ executable: true })
      renderRouter([entry.path])
      expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: entry.label })).toHaveAttribute('aria-current', 'page')
    },
  )
})
