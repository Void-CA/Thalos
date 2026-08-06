// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { EvaluationWorkspace } from './workspace'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useSceneStore } from '@/features/viewport/store'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import type { CompileResponse } from '@/features/semantic/types'
import type { ActivePlan } from '@/features/viewport/types'

/**
 * EvaluationWorkspace — the pre-execution EVALUACIÓN (hotfix
 * evaluation-workspace). A DECISION view between Programación and Ejecución:
 * "¿estás seguro que querés ejecutar esto?" with concrete actions.
 *
 * This suite pins the layout + gating contract (CDD evaluation-workspace):
 * - empty state when there is no report yet (analyzed=false) → invites to
 *   program first, with a way back to Programación;
 * - plan summary (source Tasks/Motion, plan id, waypoints, duration);
 * - problem regions GROUPS from `problem_regions` — the 200-observation dump
 *   is gone; a clean verdict when the plan has no problem regions;
 * - repair options are GATED: only meaningful when problem regions exist;
 * - recommendations render with their uniform Preview/Apply/Undo rows.
 *
 * AlternativesPanel/OptimizationPanel are stubbed: this suite verifies the
 * evaluation LAYOUT + GATING, not their internals (covered by their own tests).
 */

vi.mock('@/features/analysis/components/alternatives-panel', () => ({
  AlternativesPanel: () => <div data-testid="alternatives-panel-stub">AlternativesPanel</div>,
}))

vi.mock('@/features/analysis/components/optimization-panel', () => ({
  OptimizationPanel: () => <div data-testid="optimization-panel-stub">OptimizationPanel</div>,
}))

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const cleanReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.95,
    score: 95,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
  manipulability_series: [
    { waypoint: 0, yoshikawa: 0.9 },
    { waypoint: 1, yoshikawa: 0.8 },
  ],
}

const regionReport: AnalysisReportWire = {
  ...cleanReport,
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
}

const recommendationReport: AnalysisReportWire = {
  ...regionReport,
  recommendations: [
    {
      id: 1,
      action: {
        id: 1,
        kind: 'MoveWaypoint',
        target_observation: 3,
        priority: 'high',
        impact: 'reposition',
        parameters: {},
      },
      edit: { MoveWaypoint: { waypoint: 3 } },
      status: 'available',
    },
  ],
}

const activePlan: ActivePlan = {
  planId: 'plan-1',
  state: 'ready',
  motionType: 'PTP',
  trajectoryProgress: null,
  visualization: { waypoints: Array.from({ length: 5 }, () => ({ x: 0, y: 0, z: 0 })) as never, motionType: 'PTP' },
  segments: [
    { segmentIndex: 0, motionType: 'PTP', waypointStart: 0, waypointEnd: 1, timeStart: 0, timeEnd: 42 },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  startedAt: null,
  completedAt: null,
}

function renderWorkspace(initialPath = '/evaluation') {
  const router = createMemoryRouter([{ path: '*', element: <EvaluationWorkspace /> }], {
    initialEntries: [initialPath],
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
    useSemanticEditor.getState().reset()
    useSceneStore.getState().reset()
  })
})
afterEach(() => cleanup())

describe('EvaluationWorkspace — empty state (no report yet → analyzed=false)', () => {
  it('invites to program first and offers a way back to Programación', async () => {
    const router = renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Evaluación' })).toBeInTheDocument()
    expect(
      screen.getByText(/Evaluá el plan antes de ejecutar/i),
    ).toBeInTheDocument()
    const back = screen.getByRole('button', { name: 'Volver a Programación' })
    fireEvent.click(back)
    await waitFor(() => expect(router.state.location.pathname).toBe('/task'))
  })
})

describe('EvaluationWorkspace — plan summary (what is about to execute)', () => {
  it('shows source Tasks, plan id, waypoints, duration and instructions from the seeded plan', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
      useSemanticEditor.setState({ result: compileResult, dirty: 0 })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('plan-1')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument() // 5 waypoints (visualization)
    expect(screen.getByText('42.0s')).toBeInTheDocument() // duration from segments
    expect(screen.getByText('4')).toBeInTheDocument() // instruction count
  })

  it('derives the source as Motion when there is no compiled Task plan', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.getByText('Motion')).toBeInTheDocument()
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
  })
})

describe('EvaluationWorkspace — decision focus: grouped regions + gated actions', () => {
  it('shows a clean verdict when there are NO problem regions — and NO repair options', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
    })
    renderWorkspace()
    expect(screen.getByText(/No se detectaron problemas/i)).toBeInTheDocument()
    // Repair options only make sense when the plan HAS problem regions.
    expect(screen.queryByTestId('alternatives-panel-stub')).not.toBeInTheDocument()
    // Optimization is still a contextual action over the plan.
    expect(screen.getByTestId('optimization-panel-stub')).toBeInTheDocument()
  })

  it('groups problem regions and GATES repair options on their presence', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
    })
    renderWorkspace()
    // ProblemRegions renders the grouped region card.
    expect(
      screen.getByRole('button', { name: /Singularity near waypoint 10/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/No se detectaron problemas/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('alternatives-panel-stub')).toBeInTheDocument()
  })

  it('keeps the region drill-down within the evaluation workspace', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
    })
    const router = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /Singularity near waypoint 10/i }))
    expect(screen.getByRole('heading', { name: 'Region Details' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/evaluation')
  })
})

describe('EvaluationWorkspace — recommendations with uniform Preview/Apply/Undo', () => {
  it('renders one RecommendationRow per recommendation when present', () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
    })
    renderWorkspace()
    expect(screen.getByTestId('recommendation-row')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('renders no recommendation rows when the report carries none', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
    })
    renderWorkspace()
    expect(screen.queryByTestId('recommendation-row')).not.toBeInTheDocument()
  })
})
