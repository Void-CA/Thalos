// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AdvisorSection } from './AdvisorSection'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

vi.mock('@/features/analysis/api/plan-analysis-api', () => ({
  planAnalysisApi: {
    preview: vi.fn(async (id: number) => ({
      recommendation_id: id,
      status: 'available',
      waypoints: [
        [1.0, 2.0, 3.0],
        [1.2, 2.1, 3.1],
      ],
      metrics_before: { waypoint_count: 2 },
      metrics_after: { waypoint_count: 2 },
      health_before: 0.5,
      health_after: 0.62,
      improvement: 0.12,
      continuity: true,
    })),
    apply: vi.fn(async (id: number) => ({
      recommendation_id: id,
      status: 'available',
      plan_id: 'plan-2',
      health_before: 0.5,
      health_after: 0.62,
      improvement: 0.12,
      history_length: 1,
    })),
    undo: vi.fn(async () => ({
      plan_id: 'plan-1',
      health_before: 0.62,
      health_after: 0.5,
      improvement: -0.12,
      history_length: 0,
    })),
  },
}))

// PR4 (task 4.6): after a successful apply the row refreshes the scene so the
// viewport reflects the ACTIVE plan written back by the backend. The singleton
// service is mocked here; the row consumes `sceneService.loadScene()` exactly
// like use-scene-loader.
vi.mock('@/features/viewport/services/scene.service', () => ({
  sceneService: {
    loadScene: vi.fn(async () => ({
      scene: {},
      runtime: { robot: { id: 'scara' }, joints: [], generatedAt: '' },
      ikResult: null,
      activePlan: {
        planId: 'plan-3',
        state: 'created',
        motionType: 'program',
        trajectoryProgress: null,
        visualization: null,
        createdAt: '',
        startedAt: null,
        completedAt: null,
      },
      activeTcp: null,
      execution: null,
    })),
  },
}))

/**
 * S4b / S4.3 — Advisor projection (spec advisor-projection):
 * - AdvisorSection is a PURE consumer: receives the canonical AnalysisReportWire
 *   via props, imports zero planning stores and zero backend hooks.
 * - Interpretation is structural (Observation.kind / severity / actions /
 *   summary) — never by matching message text.
 * - API: <AdvisorSection report={report} /> — no legacy props.
 *
 * The analyzed-router tests seed `score: 92 / grade: 'Good'` in StatusBanner;
 * this projection must therefore render its summary with explicit labels
 * (e.g. "Score: 92", "Grade: Good") so it never emits a bare '92 / 100' or
 * 'Good' text node that would collide with the existing StatusBanner.
 */

const fullReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [
    {
      id: 1,
      kind: 'LowManipulability',
      severity: 'Warning',
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      location: { Waypoint: 3 },
      attributes: { value: { Number: 0.12 } },
      causes: [],
      related: [],
    },
    {
      id: 2,
      kind: 'CollisionRisk',
      severity: 'Error',
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      location: { Waypoint: 7 },
      attributes: { value: { Number: 0.02 } },
      causes: [],
      related: [],
    },
  ],
  actions: [
    {
      id: 10,
      kind: 'adjust_waypoint',
      target_observation: 1,
      priority: 'high',
      impact: 'raises manipulability',
      parameters: {},
    },
    {
      id: 11,
      kind: 'joint_centering',
      target_observation: 2,
      priority: 'high',
      impact: 'clears collision',
      parameters: {},
    },
  ],
  metrics: { duration: 0.42, waypoint_count: 8 },
  summary: {
    quality_index: 0.6,
    score: 71,
    grade: 'Fair',
    observation_count: 2,
    severity_distribution: { Error: 1, Warning: 1 },
  },
}

/** Second fixture — different code paths: Info severity, Timestamp location. */
const infoReport: AnalysisReportWire = {
  ...fullReport,
  observations: [
    {
      id: 5,
      kind: 'TrackingDeviation',
      severity: 'Info',
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      location: { Timestamp: 2 },
      attributes: {},
      causes: [],
      related: [],
    },
  ],
  actions: [{ id: 20, kind: 'retime', target_observation: 5, priority: 'medium', impact: 'reduces deviation', parameters: {} }],
  summary: {
    quality_index: 0.9,
    score: 55,
    grade: 'Poor',
    observation_count: 1,
    severity_distribution: { Info: 1 },
  },
}

afterEach(() => cleanup())

describe('AdvisorSection — pure AnalysisReport projection (S4b)', () => {  it('renders a placeholder for a null report without crashing', () => {
    render(<AdvisorSection report={null} />)
    expect(screen.getByText('No analysis available')).toBeInTheDocument()
  })

  it('projects the summary header: score, grade, severity distribution', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.getByText('Score: 71')).toBeInTheDocument()
    expect(screen.getByText('Grade: Fair')).toBeInTheDocument()
    expect(screen.getByText('Errors: 1')).toBeInTheDocument()
    expect(screen.getByText('Warnings: 1')).toBeInTheDocument()
    expect(screen.getByText('Info: 0')).toBeInTheDocument()
  })

  it('lists observations by kind + severity badge + location', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.getByText('Low Manipulability')).toBeInTheDocument()
    expect(screen.getByText('Collision Risk')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('wp3')).toBeInTheDocument()
    expect(screen.getByText('wp7')).toBeInTheDocument()
  })

  it('lists actions by kind + target observation', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.getByText('Adjust Waypoint')).toBeInTheDocument()
    expect(screen.getByText('Joint Centering')).toBeInTheDocument()
    expect(screen.getByText('target observation 1')).toBeInTheDocument()
    expect(screen.getByText('target observation 2')).toBeInTheDocument()
  })

  it('triangulates: Info severity + Timestamp location render structurally', () => {
    render(<AdvisorSection report={infoReport} />)
    expect(screen.getByText('Score: 55')).toBeInTheDocument()
    expect(screen.getByText('Grade: Poor')).toBeInTheDocument()
    expect(screen.getByText('Tracking Deviation')).toBeInTheDocument()
    expect(screen.getByText('Info')).toBeInTheDocument()
    expect(screen.getByText('Timestamp')).toBeInTheDocument()
    expect(screen.getByText('Retime')).toBeInTheDocument()
    expect(screen.getByText('target observation 5')).toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// PR3 (task 3.4) — RecommendationRow projection (spec advisor-projection):
// - recommendations[] project as N generic RecommendationRow components.
// - Every row carries UNIFORM Preview/Apply/Undo controls regardless of the
//   underlying action kind — NO per-strategy buttons, NO match_strategy /
//   defaultStrategies string dispatch.
// ══════════════════════════════════════════════════════════════════════════

/** Three recommendations of MIXED action kinds — the uniform-row contract. */
const recommendationReport: AnalysisReportWire = {
  ...fullReport,
  recommendations: [
    {
      id: 1,
      action: { id: 30, kind: 'manipulability', target_observation: 1, priority: 'high', impact: 'raises manipulability', parameters: {} },
      edit: { ReplaceSegment: { index: 0 } },
      status: 'available',
    },
    {
      id: 2,
      action: { id: 31, kind: 'singularity', target_observation: 1, priority: 'high', impact: 'rotates tool', parameters: {} },
      edit: { ReplaceSegment: { index: 0 } },
      status: 'available',
    },
    {
      id: 3,
      action: { id: 32, kind: 'waypoint', target_observation: 1, priority: 'medium', impact: 'inserts waypoint', parameters: {} },
      edit: { ReplaceSegment: { index: 0 } },
      status: 'available',
    },
  ],
}

describe('AdvisorSection — RecommendationRow projection (PR3, task 3.4)', () => {
  it('renders N uniform RecommendationRow components for N mixed-kind recommendations', () => {
    render(<AdvisorSection report={recommendationReport} />)

    // N rows — one per recommendation, all three kinds present.
    const rows = screen.getAllByTestId('recommendation-row')
    expect(rows).toHaveLength(3)
    expect(screen.getByText('Manipulability')).toBeInTheDocument()
    expect(screen.getByText('Singularity')).toBeInTheDocument()
    expect(screen.getByText('Waypoint')).toBeInTheDocument()

    // Uniform controls: exactly Preview + Apply + Undo per row.
    expect(screen.getAllByRole('button', { name: /preview/i })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /apply/i })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /undo/i })).toHaveLength(3)

    // No string-based dispatch: EVERY row exposes the same 3-control set —
    // the action kind never changes the controls offered.
    for (const row of rows) {
      const rowButtons = within(row).getAllByRole('button')
      expect(rowButtons).toHaveLength(3)
    }
  })

  it('does not render per-strategy buttons (no match_strategy / defaultStrategies)', () => {
    render(<AdvisorSection report={recommendationReport} />)
    // The materializer names must NEVER surface as controls.
    expect(screen.queryByRole('button', { name: /lift/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /rotate tool/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /insert waypoint/i })).toBeNull()
    // Only the three uniform command controls exist anywhere.
    expect(screen.getAllByRole('button')).toHaveLength(9)
  })

  it('PR4: Apply is enabled for available recommendations', () => {
    render(<AdvisorSection report={recommendationReport} />)
    const applyButtons = screen.getAllByRole('button', { name: /apply/i })
    expect(applyButtons).toHaveLength(3)
    for (const button of applyButtons) {
      expect(button).toBeEnabled()
    }
  })

  it('PR5: Undo stays disabled until this row has been applied, then reverts', async () => {
    // Spec command-endpoints "Undo restores previous plan" at the UI level:
    // Undo pops the LAST applied command, so a row's Undo only activates
    // after THAT row has been applied; clicking it reverts the applied state
    // and refreshes the scene from the backend.
    render(<AdvisorSection report={recommendationReport} />)
    const rows = screen.getAllByTestId('recommendation-row')
    const rowUndo = (i: number) => within(rows[i]).getByRole('button', { name: /undo/i })

    // Before any apply: nothing to undo — every row's Undo is disabled.
    for (const button of screen.getAllByRole('button', { name: /undo/i })) {
      expect(button).toBeDisabled()
    }

    // Apply row 0 → ONLY its Undo enables (the undo target is the last
    // applied command); the other rows stay disabled.
    fireEvent.click(screen.getAllByRole('button', { name: /apply/i })[0])
    await screen.findByText('Applied')
    expect(rowUndo(0)).toBeEnabled()
    expect(rowUndo(1)).toBeDisabled()
    expect(rowUndo(2)).toBeDisabled()

    // Undo click → backend pops the last command (no body), the applied
    // badge clears, and the row's Undo returns to disabled.
    fireEvent.click(rowUndo(0))
    await waitFor(() => {
      expect(planAnalysisApi.undo).toHaveBeenCalledTimes(1)
    })
    expect(planAnalysisApi.undo).toHaveBeenCalledWith()
    await waitFor(() => {
      expect(screen.queryByText('Applied')).toBeNull()
    })
    await waitFor(() => {
      expect(rowUndo(0)).toBeDisabled()
    })
  })

  it('D8: an unavailable recommendation keeps Apply disabled (never applied)', () => {
    const mixed = {
      ...recommendationReport,
      recommendations: recommendationReport.recommendations!.map((r, i) =>
        i === 0 ? { ...r, status: 'unavailable' as const } : r,
      ),
    }
    render(<AdvisorSection report={mixed} />)
    const applyButtons = screen.getAllByRole('button', { name: /apply/i })
    expect(applyButtons[0]).toBeDisabled()
    expect(applyButtons[1]).toBeEnabled()
    expect(applyButtons[2]).toBeEnabled()
    // Preview stays available for diagnosis even when the edit is unavailable.
    expect(screen.getAllByRole('button', { name: /preview/i })[0]).toBeEnabled()
  })

  it('triangulates: a report without recommendations renders the empty state', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.queryAllByTestId('recommendation-row')).toHaveLength(0)
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('Preview click feeds the 3D overlay through the viewport store (OptimizationPanel pattern)', async () => {
    // Spec advisor-projection "Preview overlay reuse": clicking Preview on a
    // row writes the simulated waypoints into the scene store and switches the
    // trajectory view — the SAME mechanism the OptimizationPanel uses.
    const { useSceneStore } = await import('@/features/viewport/store')
    useSceneStore.getState().setPreviewPositions(null)
    useSceneStore.getState().setTrajectoryViewMode('original')

    render(<AdvisorSection report={recommendationReport} />)
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0])

    await waitFor(() => {
      expect(useSceneStore.getState().trajectoryViewMode).toBe('preview')
    })
    expect(useSceneStore.getState().previewPositions).toEqual([
      [1.0, 2.0, 3.0],
      [1.2, 2.1, 3.1],
    ])
    // The inline report renders the simulated health delta.
    expect(await screen.findByText('Health')).toBeInTheDocument()
  })

  it('PR4: Apply click applies the edit and the UI reflects the ACTIVE plan', async () => {
    // Spec command-endpoints "Apply writes back to scene" + task 4.6 "UI
    // reflects the active plan": clicking Apply calls the backend, shows the
    // applied state, and refreshes the scene so the viewport renders the NEW
    // active plan (the write-back result).
    const { useSceneStore } = await import('@/features/viewport/store')
    useSceneStore.getState().applyScene(
      {} as any,
      { robot: { id: 'scara' }, joints: [], generatedAt: '' } as any,
      null,
      { planId: 'plan-1', state: 'created', motionType: 'program', trajectoryProgress: null, visualization: null, createdAt: '', startedAt: null, completedAt: null },
      null,
      null,
    )
    expect(useSceneStore.getState().activePlan?.planId).toBe('plan-1')

    render(<AdvisorSection report={recommendationReport} />)
    fireEvent.click(screen.getAllByRole('button', { name: /apply/i })[0])

    // The backend was called with the row's recommendation id.
    await waitFor(() => {
      expect(planAnalysisApi.apply).toHaveBeenCalledWith(1)
    })

    // The row reflects the applied state (Applied badge + new plan id).
    expect(await screen.findByText('Applied')).toBeInTheDocument()
    expect(screen.getByText('plan-2')).toBeInTheDocument()

    // The scene was refreshed from the backend: the store's active plan is now
    // the write-back result — the viewport renders the ACTIVE plan.
    await waitFor(() => {
      expect(useSceneStore.getState().activePlan?.planId).toBe('plan-3')
    })
    // The trajectory view returns to the original mode (new plan rendered).
    expect(useSceneStore.getState().trajectoryViewMode).toBe('original')
  })
})
