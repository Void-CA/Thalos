// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
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

// The trajectory view mounts ECharts GL, which needs a WebGL context jsdom
// cannot provide. This suite only asserts the trajectory DOM surface, so the
// whole GL frontier is stubbed (no echarts-gl transform under full-parallel
// load); the real option mapping is covered by trajectory-view.test.tsx.
vi.mock('@/shared/charts/gl-adapter', () => ({
  buildTrajectoryOption: vi.fn(() => ({})),
  mountGLChart: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
  resizeGLChart: vi.fn(),
  disposeGLChart: vi.fn(),
}))

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
    {
      segmentIndex: 0,
      motionType: 'PTP',
      waypointStart: 0,
      waypointEnd: 1,
      timeStart: 0,
      timeEnd: 42,
      source: { MoveJ: { origin: 'base', target: [0.1, 0.2, 0.3], max_velocity: null, max_acceleration: null } },
    },
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

const assessedReport: AnalysisReportWire = {
  ...recommendationReport,
  assessment: {
    risk: 'high',
    quality: 0.31,
    triggered_rules: [
      { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
      { id: 'R11_danger_zone', category: 'manipulability', priority: 10 },
    ],
    evidence: { manipulability: 0.2, singularity_proximity: 0.4 },
    recommendations: [
      {
        action_kind: 'Manipulability',
        region_id: 3,
        rationale: 'Improve manipulability near the flagged region.',
      },
    ],
    trace: [
      {
        rule_id: 'R07_low_manipulability',
        priority: 3,
        bindings: { 'Manipulability IS low': '0.667' },
        derived_output: { danger_zone: true },
      },
      {
        rule_id: 'R11_danger_zone',
        priority: 10,
        bindings: { danger_zone: 'true' },
        derived_output: {},
      },
    ],
  },
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

  it('renders the trajectory view with colored-region legend for the evaluated plan', async () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(
      await screen.findByRole('img', { name: /Trajectory with problem regions/i }, { timeout: 5000 }),
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

describe('EvaluationWorkspace — plan summary metric chips (R4/R1)', () => {
  it('renders the wire aggregate metrics as mini-cards when present', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...cleanReport,
          metrics: {
            waypoint_count: 10,
            trajectory_duration: 12.5,
            avg_manipulability: 0.456,
            min_manipulability: 0.123,
            near_singular_count: 3,
            singular_count: 1,
            has_collisions: 0,
          },
        },
      })
    })
    renderWorkspace()
    const container = screen.getByTestId('metric-chips')
    expect(container).toBeInTheDocument()
    expect(within(container).getAllByTestId('metric-chip').length).toBeGreaterThanOrEqual(3)
    expect(within(container).getByText('0.456')).toBeInTheDocument() // avg manipulability
    expect(within(container).getByText(/3 cerca · 1 exactas/)).toBeInTheDocument()
    expect(within(container).getByText('12.5s')).toBeInTheDocument() // analysis duration
  })

  it('omits the "Yoshikawa min" card (min_manipulability is ~0 through any singularity)', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...cleanReport,
          metrics: {
            waypoint_count: 10,
            avg_manipulability: 0.456,
            min_manipulability: 0.123,
            has_collisions: 0,
          },
        },
      })
    })
    renderWorkspace()
    expect(screen.queryByText('Yoshikawa min')).not.toBeInTheDocument()
    expect(screen.queryByText('0.123')).not.toBeInTheDocument()
    expect(screen.getByText('0.456')).toBeInTheDocument() // avg survives
  })

  it('shows the minimum-clearance chip with its waypoint when the metrics carry it (R1)', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...cleanReport,
          metrics: {
            waypoint_count: 10,
            min_collision_distance: 0.03,
            min_collision_waypoint: 4,
            has_collisions: 0,
          },
        },
      })
    })
    renderWorkspace()
    expect(screen.getByText(/0.03 m @ wp4/)).toBeInTheDocument()
  })

  it('shows a green "Sin colisiones" chip when the plan has no collisions and no clearance value', () => {
    act(() => {
      useAnalysisStore.setState({
        report: { ...cleanReport, metrics: { waypoint_count: 10, has_collisions: 0 } },
      })
    })
    renderWorkspace()
    expect(screen.getByText('Sin colisiones')).toBeInTheDocument()
  })

  it('renders no chips when the report carries no metrics', () => {
    act(() => {
      useAnalysisStore.setState({ report: cleanReport })
    })
    renderWorkspace()
    expect(screen.queryByTestId('metric-chips')).not.toBeInTheDocument()
  })
})

describe('EvaluationWorkspace — problem region share of the plan (R5)', () => {
  it('labels each problem region with its % of the plan in the list', () => {
    act(() => {
      useAnalysisStore.setState({
        report: { ...regionReport, metrics: { waypoint_count: 22, has_collisions: 0 } },
      })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    // region waypoint_count 11 of 22 → 50.0%.
    expect(screen.getByText('50.0% del plan')).toBeInTheDocument()
  })

  it('omits the share when the plan metrics carry no waypoint_count', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.queryByText(/del plan/)).not.toBeInTheDocument()
  })
})

describe('EvaluationWorkspace — intelligent assessment section (workspace-analysis)', () => {
  it('renders the section when the report carries an assessment, between the verdict and the grid', () => {
    act(() => {
      useAnalysisStore.setState({ report: assessedReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    const section = screen.getByTestId('intelligent-assessment')
    expect(section).toBeInTheDocument()
    // Placement: inside the single scroll container, before the master grid.
    expect(section.compareDocumentPosition(screen.getByTestId('evaluation-master')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Summary visible: risk + quality + triggered rules.
    expect(within(section).getByText('high')).toBeInTheDocument()
    expect(within(section).getByText('0.31')).toBeInTheDocument()
    expect(within(section).getByText('R07_low_manipulability')).toBeInTheDocument()
  })

  it('hides the section entirely when the report carries no assessment', () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.queryByTestId('intelligent-assessment')).not.toBeInTheDocument()
    expect(screen.queryByText('Intelligent Assessment')).not.toBeInTheDocument()
    expect(screen.queryByText('Risk Level')).not.toBeInTheDocument()
    // No empty placeholder/error either — the rest of the workspace is intact.
    expect(screen.getByTestId('evaluation-master')).toBeInTheDocument()
  })

  it('keeps the trace collapsed by default inside the workspace', () => {
    act(() => {
      useAnalysisStore.setState({ report: assessedReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    const toggle = within(screen.getByTestId('intelligent-assessment')).getByTestId('assessment-trace-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('assessment-trace')).not.toBeInTheDocument()
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

describe('EvaluationWorkspace — structured program view (Program)', () => {
  it('renders the Program section with the active plan segment rows inside /evaluation', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()

    expect(screen.getByText('Program')).toBeInTheDocument()
    expect(screen.getByTestId('program-segment-0')).toBeInTheDocument()
    expect(screen.getByTestId('program-segment-0')).toHaveTextContent('MoveJ')
  })

  it('renders the Program empty state when the active plan carries no segments', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: { ...activePlan, segments: null } })
    })
    renderWorkspace()

    expect(screen.getByTestId('program-empty')).toBeInTheDocument()
  })
})

describe('EvaluationWorkspace — master-detail layout (context | action)', () => {
  it('renders both panels: the master (context) and the detail (action)', () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    expect(screen.getByTestId('evaluation-master')).toBeInTheDocument()
    expect(screen.getByTestId('evaluation-detail')).toBeInTheDocument()
  })

  it('keeps the trajectory view and both jacobian charts in the master panel', async () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    const master = screen.getByTestId('evaluation-master')
    // The lazy ECharts chunk resolves asynchronously — explicit timeout.
    expect(
      await within(master).findByRole('img', { name: /Trajectory with problem regions/i }, { timeout: 5000 }),
    ).toBeInTheDocument()
    const charts = await within(master).findAllByTestId('chart', {}, { timeout: 5000 })
    expect(charts).toHaveLength(2)
  })

  it('shows the ProblemRegions chooser, ProgramView and Recommendations in the detail when no region is selected', () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    const detail = screen.getByTestId('evaluation-detail')
    expect(within(detail).getByText('Problem Regions')).toBeInTheDocument()
    expect(
      within(detail).getByRole('button', { name: /Singularity near waypoint 10/i }),
    ).toBeInTheDocument()
    expect(within(detail).getByTestId('program-view')).toBeInTheDocument()
    expect(within(detail).getByTestId('recommendation-row')).toBeInTheDocument()
    expect(
      within(detail).queryByRole('heading', { name: 'Region Details' }),
    ).not.toBeInTheDocument()
  })

  it('swaps the chooser for the RegionInspector in the detail when a region is selected, keeping ProgramView', () => {
    act(() => {
      useAnalysisStore.setState({ report: recommendationReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /Singularity near waypoint 10/i }))
    const detail = screen.getByTestId('evaluation-detail')
    expect(within(detail).getByRole('heading', { name: 'Region Details' })).toBeInTheDocument()
    expect(within(detail).queryByText('Problem Regions')).not.toBeInTheDocument()
    expect(within(detail).getByTestId('program-view')).toBeInTheDocument()
  })

  it('filters recommendations to the selected region, keeping plan-general ones', () => {
    const twoRegionReport: AnalysisReportWire = {
      ...cleanReport,
      problem_regions: [
        {
          id: 7,
          kind: 'singularity',
          severity: 'critical',
          waypoint_start: 10,
          waypoint_end: 20,
          waypoint_count: 11,
        },
        {
          id: 8,
          kind: 'joint_limit',
          severity: 'warning',
          waypoint_start: 30,
          waypoint_end: 40,
          waypoint_count: 11,
        },
      ],
      observations: [
        {
          id: 3,
          kind: 'Singularity',
          severity: 'Error',
          artifact: { kind: 'MotionPlan', id: 'plan-1' },
          location: { Waypoint: 15 },
          attributes: {},
          causes: [],
          related: [],
        },
        {
          id: 4,
          kind: 'ConstraintViolation',
          severity: 'Warning',
          artifact: { kind: 'MotionPlan', id: 'plan-1' },
          location: { Waypoint: 35 },
          attributes: {},
          causes: [],
          related: [],
        },
      ],
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
          edit: { MoveWaypoint: { waypoint: 15 } },
          status: 'available',
        },
        {
          id: 2,
          action: {
            id: 2,
            kind: 'RotateTool',
            target_observation: 4,
            priority: 'medium',
            impact: 'medium',
            parameters: {},
          },
          edit: { ReplaceSegment: { index: 0 } },
          status: 'available',
        },
      ],
    }
    act(() => {
      useAnalysisStore.setState({ report: twoRegionReport })
      useSceneStore.setState({ activePlan })
    })
    renderWorkspace()
    // No selection → all recommendations.
    expect(screen.getAllByTestId('recommendation-row')).toHaveLength(2)
    // Selecting region 7 (wp 10–20) keeps only the recommendation whose
    // target observation anchors at wp 15.
    act(() => {
      useAnalysisStore.getState().selectRegion(7)
    })
    expect(screen.getAllByTestId('recommendation-row')).toHaveLength(1)
    expect(screen.getByText('Move Waypoint')).toBeInTheDocument()
    // Selecting region 8 (wp 30–40) keeps only the wp 35 recommendation.
    act(() => {
      useAnalysisStore.getState().selectRegion(8)
    })
    expect(screen.getAllByTestId('recommendation-row')).toHaveLength(1)
    expect(screen.getByText('Rotate Tool')).toBeInTheDocument()
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
