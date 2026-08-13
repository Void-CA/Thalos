// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecommendation, recommendationKindLabel } from './recommendation-model'
import type {
  AnalysisReportWire,
  RecommendationWire,
} from '@/shared/contracts/analysis-report'
import type { PreviewResponse, ApplyResponse, UndoResponse } from './api/plan-analysis.types'

/**
 * useRecommendation — the SINGLE recommendation domain model (P1.2): state
 * machine (previewing/preview, applying/applied, undoing), `history_length`
 * read verbatim from server responses (never local ++/--), refetch-after-apply/
 * undo via `onRefetch`, and the derived wire data (region/span/strategy/edit,
 * health delta display). Both RecommendationRow and RecommendationCard are thin
 * presentations of this model.
 */

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
}))

vi.mock('@/features/analysis/api/plan-analysis-api', () => ({
  planAnalysisApi: {
    preview: apiMocks.preview,
    apply: apiMocks.apply,
    undo: apiMocks.undo,
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
  apiMocks.preview.mockReset()
  apiMocks.apply.mockReset()
  apiMocks.undo.mockReset()
  apiMocks.preview.mockResolvedValue(previewResponse)
  apiMocks.apply.mockResolvedValue(applyResponse)
  apiMocks.undo.mockResolvedValue(undoResponse)
})

describe('useRecommendation — initial state', () => {
  it('starts idle: no flags, no preview/applied, historyLength null, no undo', () => {
    const { result } = renderHook(() => useRecommendation(recommendation, report))
    expect(result.current.state.previewing).toBe(false)
    expect(result.current.state.preview).toBeNull()
    expect(result.current.state.applying).toBe(false)
    expect(result.current.state.applied).toBeNull()
    expect(result.current.state.undoing).toBe(false)
    expect(result.current.state.historyLength).toBeNull()
    expect(result.current.state.error).toBeNull()
    expect(result.current.state.canUndo).toBe(false)
    expect(result.current.state.unavailable).toBe(false)
  })

  it('exposes unavailable=true for an unavailable edit (D8) without calling the api', () => {
    const { result } = renderHook(() =>
      useRecommendation({ ...recommendation, status: 'unavailable' }, report),
    )
    expect(result.current.state.unavailable).toBe(true)
  })

  it('exposes a human-readable reason for an unavailable edit (ADR-2)', () => {
    const { result } = renderHook(() =>
      useRecommendation(
        { ...recommendation, status: 'unavailable', reason: 'ik_failed' },
        report,
      ),
    )
    expect(result.current.state.unavailable).toBe(true)
    expect(result.current.derived.reason).toBe('IK could not converge')
  })

  it('exposes no reason for an available recommendation (additive wire)', () => {
    const { result } = renderHook(() => useRecommendation(recommendation, report))
    expect(result.current.derived.reason).toBeNull()
  })

  it('maps EVERY structured wire reason to a human-readable label (M4, ADR-2)', () => {
    // The full reason vocabulary (spec recommendation-availability-contract):
    // the UI must distinguish each class, never render raw wire keys.
    const cases: Array<[NonNullable<RecommendationWire['reason']>, string]> = [
      ['ik_failed', 'IK could not converge'],
      ['compile_failed', 'The edited program does not compile'],
      ['planning_failed', 'Planning did not converge on a clean region'],
      ['unreachable_configuration', 'The target configuration is unreachable'],
      ['not_applicable', 'This remediation does not apply here'],
      ['unsupported', 'This segment type is not supported'],
    ]
    for (const [reason, expected] of cases) {
      const { result } = renderHook(() =>
        useRecommendation({ ...recommendation, status: 'unavailable', reason }, report),
      )
      expect(result.current.state.unavailable).toBe(true)
      expect(result.current.derived.reason).toBe(expected)
    }
  })

  it('stays null when the wire carries an unavailable status but NO reason (additive contract)', () => {
    // Old payloads: status without reason must not fabricate a label.
    const { result } = renderHook(() =>
      useRecommendation({ ...recommendation, status: 'unavailable' }, report),
    )
    expect(result.current.state.unavailable).toBe(true)
    expect(result.current.derived.reason).toBeNull()
  })
})

describe('useRecommendation — preview (PR3, read-only)', () => {
  it('stores the preview response and returns it; never re-fetches the report', async () => {
    const onRefetch = vi.fn()
    const { result } = renderHook(() => useRecommendation(recommendation, report, onRefetch))

    let returned: PreviewResponse | null = null
    await act(async () => {
      returned = await result.current.handlers.handlePreview()
    })

    expect(apiMocks.preview).toHaveBeenCalledWith(recommendation.id)
    expect(returned).toEqual(previewResponse)
    expect(result.current.state.preview).toEqual(previewResponse)
    expect(result.current.state.previewing).toBe(false)
    expect(onRefetch).not.toHaveBeenCalled()
  })

  it('clears the error and reports failures through state (null return)', async () => {
    apiMocks.preview.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useRecommendation(recommendation, report))

    let returned: PreviewResponse | null = previewResponse
    await act(async () => {
      returned = await result.current.handlers.handlePreview()
    })

    expect(returned).toBeNull()
    expect(result.current.state.error).toBe('boom')
    expect(result.current.state.preview).toBeNull()
    expect(result.current.state.previewing).toBe(false)
  })
})

describe('useRecommendation — apply (PR4) + history_length from server', () => {
  it('stores applied, reads history_length from the response verbatim, refetches', async () => {
    const onRefetch = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useRecommendation(recommendation, report, onRefetch))

    await act(async () => {
      await result.current.handlers.handleApply()
    })

    expect(apiMocks.apply).toHaveBeenCalledWith(recommendation.id)
    expect(result.current.state.applied).toEqual(applyResponse)
    expect(result.current.state.historyLength).toBe(1)
    expect(result.current.state.canUndo).toBe(true)
    expect(result.current.state.applying).toBe(false)
    // intelligible-repair-loop (3.2): the UI must reflect the APPLIED plan.
    expect(onRefetch).toHaveBeenCalledTimes(1)
  })

  it('propagates apply failures through state and does NOT refetch', async () => {
    apiMocks.apply.mockRejectedValue(new Error('apply failed'))
    const onRefetch = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useRecommendation(recommendation, report, onRefetch))

    let returned: ApplyResponse | null = applyResponse
    await act(async () => {
      returned = await result.current.handlers.handleApply()
    })

    expect(returned).toBeNull()
    expect(result.current.state.error).toBe('apply failed')
    expect(result.current.state.applied).toBeNull()
    expect(result.current.state.historyLength).toBeNull()
    expect(onRefetch).not.toHaveBeenCalled()
  })

  it('history_length is SERVER-RETURNED — Undo enables exactly when the server reports > 0', async () => {
    const onRefetch = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useRecommendation(recommendation, report, onRefetch))

    await act(async () => {
      await result.current.handlers.handleApply()
    })
    expect(result.current.state.historyLength).toBe(1)
    expect(result.current.state.canUndo).toBe(true)

    await act(async () => {
      await result.current.handlers.handleUndo()
    })
    // The server said 0 after the pop — Undo must go back to disabled.
    expect(result.current.state.historyLength).toBe(0)
    expect(result.current.state.canUndo).toBe(false)
  })

  it('does not do local arithmetic — a 2-from-server history stays 2', async () => {
    apiMocks.apply.mockResolvedValue({ ...applyResponse, history_length: 2 })
    const onRefetch = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useRecommendation(recommendation, report, onRefetch))

    await act(async () => {
      await result.current.handlers.handleApply()
    })
    expect(result.current.state.historyLength).toBe(2)
    expect(result.current.state.canUndo).toBe(true)
  })
})

describe('useRecommendation — undo (PR5, O(1))', () => {
  it('clears the applied feedback, reads history_length from the undo response, refetches', async () => {
    const onRefetch = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useRecommendation(recommendation, report, onRefetch))

    await act(async () => {
      await result.current.handlers.handleApply()
    })
    expect(result.current.state.applied).toEqual(applyResponse)

    let returned: UndoResponse | null = null
    await act(async () => {
      returned = await result.current.handlers.handleUndo()
    })

    expect(returned).toEqual(undoResponse)
    expect(apiMocks.undo).toHaveBeenCalledTimes(1)
    expect(result.current.state.applied).toBeNull()
    expect(result.current.state.historyLength).toBe(0)
    expect(result.current.state.undoing).toBe(false)
    // intelligible-repair-loop (3.3): display restores the PREVIOUS assessment.
    expect(onRefetch).toHaveBeenCalledTimes(2)
  })
})

describe('useRecommendation — derived data (single source for both presentations)', () => {
  it('resolves kind label, region, span, strategy and edit summary from the report', () => {
    const { result } = renderHook(() => useRecommendation(recommendation, report))
    expect(result.current.derived.kindLabel).toBe('Move Waypoint')
    expect(recommendationKindLabel('MoveWaypoint')).toBe('Move Waypoint')
    expect(result.current.derived.region).toEqual(region)
    expect(result.current.derived.span).toBe('wp10–wp20')
    expect(result.current.derived.strategy).toEqual(['Joint centering'])
    expect(result.current.derived.edit).toEqual({
      variant: 'MoveWaypoint',
      params: 'segment_index 0',
    })
  })

  it('degrades region/span/strategy to null when the report cannot resolve the chain', () => {
    const { result } = renderHook(() =>
      useRecommendation(
        { ...recommendation, action: { ...recommendation.action, target_observation: 999 } },
        report,
      ),
    )
    expect(result.current.derived.region).toBeNull()
    expect(result.current.derived.span).toBeNull()
    expect(result.current.derived.strategy).toBeNull()
  })

  it('renders the applied health delta as a comparison (Health 50% → 62%), not a verdict', async () => {
    const { result } = renderHook(() => useRecommendation(recommendation, report))
    await act(async () => {
      await result.current.handlers.handleApply()
    })
    expect(result.current.derived.applied).toEqual({
      planId: 'plan-2',
      beforePct: '50%',
      afterPct: '62%',
      improved: true,
    })
  })

  it('renders the preview health delta + metrics comparison identically for row/card', async () => {
    const { result } = renderHook(() => useRecommendation(recommendation, report))
    await act(async () => {
      await result.current.handlers.handlePreview()
    })
    expect(result.current.derived.preview).toEqual({
      beforePct: '50%',
      afterPct: '62%',
      deltaPct: '+24.0%',
      improved: true,
      regressed: false,
      noop: false,
      waypointsBefore: '10',
      waypointsAfter: '8',
      continuity: 'continuous',
    })
  })

  it('clears the applied/preview summaries when the flow is undone / not yet run', () => {
    const { result } = renderHook(() => useRecommendation(recommendation, report))
    expect(result.current.derived.applied).toBeNull()
    expect(result.current.derived.preview).toBeNull()
  })
})
