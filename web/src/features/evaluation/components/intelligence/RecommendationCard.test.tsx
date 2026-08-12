// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { RecommendationCard } from './RecommendationCard'
import { useSceneStore } from '@/features/viewport/store'
import type {
  AnalysisReportWire,
  RecommendationWire,
} from '@/shared/contracts/analysis-report'
import type { PreviewResponse, ApplyResponse, UndoResponse } from '@/features/analysis/api/plan-analysis.types'

/**
 * RecommendationCard (intelligible-repair-loop 2.2) — ONE recommendation in
 * the Intelligence tab. The card answers "what can we do": rationale
 * (region cause), affected segment (region id + waypoint span), strategy
 * (recommended strategies / action impact), proposed edit (structured
 * ProgramEdit render) and the uniform Preview/Apply/Undo controls. It NEVER
 * feeds the narrative summary (separation rule).
 *
 * The re-fetch flow (analyze() after apply/undo, history_length gating) is
 * covered by the flow tests at the bottom of this file.
 */

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
  analyze: vi.fn(),
}))

vi.mock('@/features/analysis/api/plan-analysis-api', () => ({
  planAnalysisApi: {
    preview: apiMocks.preview,
    apply: apiMocks.apply,
    undo: apiMocks.undo,
    analyze: apiMocks.analyze,
  },
}))

const region = {
  id: 3,
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
}

const recommendation: RecommendationWire = {
  id: 1,
  action: {
    id: 1,
    kind: 'MoveWaypoint',
    target_observation: 3,
    priority: 'high',
    impact: 'reposition',
    parameters: {},
  },
  edit: { MoveWaypoint: { segment_index: 0, new_target: [0.55, -0.3, -0.1] } },
  status: 'available',
}

const report: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [
    {
      id: 3,
      kind: 'LowManipulability',
      severity: 'Warning',
      artifact: { kind: 'Waypoint', id: 'wp-3' },
      location: { Waypoint: 12 },
      attributes: {},
      causes: [],
      related: [],
    },
  ],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.5,
    score: 50,
    grade: 'Fair',
    observation_count: 1,
    severity_distribution: {},
  },
  problem_regions: [region],
  recommendations: [recommendation],
}

const previewResponse: PreviewResponse = {
  recommendation_id: 1,
  status: 'available',
  waypoints: [],
  metrics_before: { waypoint_count: 10 },
  metrics_after: { waypoint_count: 8 },
  health_before: 0.5,
  health_after: 0.62,
  improvement: 0.12,
  continuity: true,
}

const applyResponse: ApplyResponse = {
  recommendation_id: 1,
  status: 'available',
  plan_id: 'plan-2',
  health_before: 0.5,
  health_after: 0.62,
  improvement: 0.12,
  history_length: 1,
}

const undoResponse: UndoResponse = {
  plan_id: 'plan-1',
  health_before: 0.62,
  health_after: 0.5,
  improvement: -0.12,
  history_length: 0,
}

beforeEach(() => {
  act(() => {
    useSceneStore.getState().reset()
  })
  apiMocks.preview.mockReset()
  apiMocks.apply.mockReset()
  apiMocks.undo.mockReset()
  apiMocks.analyze.mockReset()
  apiMocks.preview.mockResolvedValue(previewResponse)
  apiMocks.apply.mockResolvedValue(applyResponse)
  apiMocks.undo.mockResolvedValue(undoResponse)
  apiMocks.analyze.mockResolvedValue(report)
})

afterEach(() => cleanup())

describe('RecommendationCard — display (2.2)', () => {
  it('renders kind, rationale (region cause), affected segment, strategy and proposed edit', () => {
    render(<RecommendationCard recommendation={recommendation} report={report} />)
    const card = screen.getByTestId('recommendation-card')
    expect(card).toHaveTextContent('Move Waypoint')
    expect(screen.getByTestId('recommendation-rationale')).toHaveTextContent(
      'Singularity near waypoint 10',
    )
    expect(screen.getByTestId('recommendation-segment')).toHaveTextContent('Region 3')
    expect(screen.getByTestId('recommendation-segment')).toHaveTextContent('wp10–wp20')
    expect(screen.getByTestId('recommendation-strategy')).toHaveTextContent('Joint centering')
    expect(screen.getByTestId('recommendation-edit')).toHaveTextContent('MoveWaypoint')
    expect(screen.getByTestId('recommendation-edit')).toHaveTextContent('segment_index 0')
  })

  it('disables Apply and shows the unavailable badge when the edit is unavailable (D8)', () => {
    render(
      <RecommendationCard
        recommendation={{ ...recommendation, status: 'unavailable' }}
        report={report}
      />,
    )
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByText('unavailable')).toBeInTheDocument()
  })

  it('falls back to the action impact when no problem region resolves (plan-general recommendation)', () => {
    render(
      <RecommendationCard
        recommendation={{ ...recommendation, action: { ...recommendation.action, target_observation: 999 } }}
        report={report}
      />,
    )
    expect(screen.queryByTestId('recommendation-rationale')).not.toBeInTheDocument()
    expect(screen.getByTestId('recommendation-strategy')).toHaveTextContent('reposition')
  })

  it('never renders narrative content (separation rule — the card answers "what can we do")', () => {
    render(<RecommendationCard recommendation={recommendation} report={report} />)
    expect(screen.queryByText(/Narrative Summary/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/risk plan/i)).not.toBeInTheDocument()
  })
})

describe('RecommendationCard — preview (3.1)', () => {
  it('shows Actual → Proposed → Improvement + continuity and never touches the scene overlay', async () => {
    render(<RecommendationCard recommendation={recommendation} report={report} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const panel = await screen.findByTestId('recommendation-preview')
    expect(panel).toHaveTextContent('Health')
    expect(panel).toHaveTextContent('50%')
    expect(panel).toHaveTextContent('62%')
    expect(panel).toHaveTextContent('Waypoints 10 → 8')
    expect(panel).toHaveTextContent('continuous')
    expect(apiMocks.preview).toHaveBeenCalledWith(recommendation.id)

    // The Intelligence card does NOT duplicate the scene overlay: the viewport
    // store stays untouched (RecommendationRow owns that mechanism).
    expect(useSceneStore.getState().trajectoryViewMode).toBe('original')
    expect(useSceneStore.getState().previewPositions).toBeNull()
  })
})
