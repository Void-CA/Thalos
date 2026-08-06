// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { EvaluationWorkspace } from './workspace'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useSceneStore } from '@/features/viewport/store'
import { installCanvasMock } from '@/test/canvas-mock'
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
 * - plan summary (source Tasks/Motion, plan id, waypoints, duration, DOF);
 * - trajectory view: the FULL evaluated trajectory with problem regions colored;
 * - 3-portion grid: Yoshikawa chart | Jacobian determinant chart | problem
 *   regions list + selected region detail (RegionInspector);
 * - problem regions GROUPS from `problem_regions` — the 200-observation dump
 *   is gone; a clean verdict when the plan has no problem regions;
 * - recommendations render with their uniform Preview/Apply/Undo rows;
 * - repair options + optimization are HIDDEN (post-MVP): they showed but did
 *   not communicate, and offered no real way to correct the trajectory — the
 *   post-MVP strategy returns a resolved Motion/Task program instead.
 */

function waypoints(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    position: [i, 0, 0] as [number, number, number],
    orientation: [1, 0, 0, 0] as [number, number, number, number],
    joints: [] as number[],
    timestamp: i,
    waypoint_type: (i === 0 ? 'Start' : i === count - 1 ? 'Goal' : 'Via') as 'Start' | 'Goal' | 'Via',
  }))
}

const activePlan: ActivePlan = {
  planId: 'plan-1',
  state: 'ready',
  motionType: 'PTP',
  trajectoryProgress: null,
  visualization: { waypoints: waypoints(5), motionType: 'PTP' },
  segments: [
    { segmentIndex: 0, motionType: 'PTP', waypointStart: 0, waypointEnd: 1, timeStart: 0, timeEnd: 42 },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  startedAt: null,
  completedAt: null,
}

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
    { waypoint: 0, yoshikawa: 0.9, det_jtj: 0.81 },
    { waypoint: 1, yoshikawa: 0.8, det_jtj: 0.64 },
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
  // The 3-portion grid renders the two jacobian charts (lazy ECharts) — the
  // jsdom canvas needs the no-op 2D context + forced layout shims.
  installCanvasMock()
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

  it('shows the robot DOF and initial joints when the runtime is known', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
      useSceneStore.setState({
        activePlan,
        runtime: {
          robot: { id: 'planar_2r', display_name: 'Planar 2R', dof: 2, joints: [] },
          joints: [0.1, 0.2],
          generatedAt: '2026-01-01T00:00:00Z',
        },
      })
    })
    renderWorkspace()
    expect(screen.getByText('2')).toBeInTheDocument() // DOF
    expect(screen.getByText('[0.10, 0.20]')).toBeInTheDocument() // initial joints
  })
})

describe('EvaluationWorkspace — decision focus: trajectory + grouped regions, no dead actions', () => {
  it('shows a clean verdict when there are NO problem regions', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.getByText(/No se detectaron problemas/i)).toBeInTheDocument()
  })

  it('renders the trajectory view with colored-region legend for the evaluated plan', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(
      screen.getByRole('img', { name: /Trajectory with problem regions/i }),
    ).toBeInTheDocument()
    // Legend swatch (also matches the Critical tier header in ProblemRegions).
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0)
  })

  it('groups problem regions and KEEPS repair options and optimization hidden', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    // ProblemRegions renders the grouped region card.
    expect(
      screen.getByRole('button', { name: /Singularity near waypoint 10/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/No se detectaron problemas/i)).not.toBeInTheDocument()
    // Post-MVP: repair/optimization SHOWED but did not communicate and had no
    // real way to fix the trajectory — hidden from the evaluation view.
    expect(screen.queryByText('Repair Options')).not.toBeInTheDocument()
    expect(screen.queryByText(/Optimize Trajectory/i)).not.toBeInTheDocument()
  })

  it('keeps the region drill-down within the evaluation workspace', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan })
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

describe('EvaluationWorkspace — 3-portion grid (charts | charts | region detail)', () => {
  it('renders the two jacobian charts, the problem regions list and the region detail placeholder', async () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()

    // The lazy ECharts chunk resolves asynchronously — the two chart cards
    // mount once the module loads (explicit timeout under parallel load).
    const charts = await screen.findAllByTestId('chart', {}, { timeout: 5000 })
    expect(charts).toHaveLength(2)
    // Porción 3: problem regions list + the "select a region" placeholder.
    expect(screen.getByText('Problem Regions')).toBeInTheDocument()
    expect(screen.getByText(/select a region/i)).toBeInTheDocument()
  })

  it('keeps the region list, trajectory and recommendations visible while inspecting a region', () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    // Selecting a region opens the RegionInspector in porción 3 WITHOUT
    // hiding the grouped regions list or the trajectory (charts stay put).
    fireEvent.click(screen.getByRole('button', { name: /Singularity near waypoint 10/i }))
    expect(screen.getByRole('heading', { name: 'Region Details' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Singularity near waypoint 10/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /Trajectory with problem regions/i }),
    ).toBeInTheDocument()
    // The inspector co-renders with the recommendations in the same layout.
    expect(screen.getByTestId('recommendation-row')).toBeInTheDocument()
  })

  it('renders a placeholder when no region is selected (porción 3 stays put)', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.getByText(/select/i)).toBeInTheDocument()
  })
})

describe('EvaluationWorkspace — recommendation dedup (frontend safety net)', () => {
  const row = (id: number, kind: string, edit: Record<string, unknown>) => ({
    id,
    action: {
      id,
      kind,
      target_observation: 3,
      priority: 'high',
      impact: 'reposition',
      parameters: {},
    },
    edit,
    status: 'available' as const,
  })

  it('collapses duplicate recommendations sharing kind + edit variant into one row', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...cleanReport,
          recommendations: [
            row(1, 'MoveWaypoint', { MoveWaypoint: { waypoint: 3 } }),
            row(2, 'MoveWaypoint', { MoveWaypoint: { waypoint: 3 } }),
          ],
        },
      })
    })
    renderWorkspace()
    expect(screen.getAllByTestId('recommendation-row')).toHaveLength(1)
  })

  it('keeps recommendations whose kind or edit variant differs', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...cleanReport,
          recommendations: [
            row(1, 'MoveWaypoint', { MoveWaypoint: { waypoint: 3 } }),
            row(2, 'RotateTool', { ReplaceSegment: { index: 0 } }),
          ],
        },
      })
    })
    renderWorkspace()
    expect(screen.getAllByTestId('recommendation-row')).toHaveLength(2)
  })
})
