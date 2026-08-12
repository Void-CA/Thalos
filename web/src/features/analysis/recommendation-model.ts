import { useMemo, useState } from 'react'
import { planAnalysisApi } from './api/plan-analysis-api'
import { refetchAnalysis } from './api/refetch-analysis'
import type { ApplyResponse, PreviewResponse, UndoResponse } from './api/plan-analysis.types'
import { recommendationRegionId, waypointOf } from '@/shared/contracts/analysis-report'
import type {
  AnalysisReportWire,
  ProblemRegionWire,
  RecommendationWire,
} from '@/shared/contracts/analysis-report'

/**
 * useRecommendation — the SINGLE recommendation domain model shared by the
 * Evaluation tab row (RecommendationRow) and the Intelligence tab card
 * (RecommendationCard). The two presentations render the same model: all
 * Preview/Apply/Undo behavior, the `history_length` gating and the derived
 * wire data live here, ONCE.
 *
 * Behavior owned by the model (P1.2 unification):
 * - state machine: previewing/preview, applying/applied, undoing, error;
 * - `historyLength` is ALWAYS the value LAST RETURNED by the server
 *   (ApplyResponse/UndoResponse). The UI never ++/-- locally — Undo renders
 *   only while the latest server value is > 0 (`canUndo`);
 * - after Apply/Undo the model re-fetches the canonical report
 *   (`onRefetch`, default `refetchAnalysis`) so verdict, narrative, regions
 *   and metrics derive from server state — never from a preview or a local
 *   delta;
 * - an `unavailable` edit exposes `unavailable` (presentations disable Apply).
 *
 * Presentation concerns stay in the presentations: RecommendationRow layers
 * the 3D scene overlay (single owner), RecommendationCard does not.
 */

// ─── Pure display helpers (shared so row and card render identically) ──────

/** Machine-readable kind → display label (cosmetic only — interpretation
 *  never branches on this string). */
export function recommendationKindLabel(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Structured wire reason → human-readable label (design ADR-2). Returns
 *  null for available/undetermined recommendations or when the wire carries
 *  no reason (additive contract — old payloads omit the field). Display-only:
 *  presentations render it; they never branch logic on the string. */
export function unavailabilityReasonLabel(
  reason?: RecommendationWire['reason'],
): string | null {
  if (!reason) return null
  const labels: Record<NonNullable<RecommendationWire['reason']>, string> = {
    ik_failed: 'IK could not converge',
    compile_failed: 'The edited program does not compile',
    planning_failed: 'Planning did not converge on a clean region',
    unreachable_configuration: 'The target configuration is unreachable',
    not_applicable: 'This remediation does not apply here',
    unsupported: 'This segment type is not supported',
  }
  return labels[reason]
}

/** Health fraction (0..1) → whole-percent display ("62%"). One implementation
 *  so row and card can never render the same server value differently. */
function healthPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

/** Signed percentage change between two health values ("+24.0%"). */
function healthDeltaPct(before: number, after: number): string {
  if (before === 0) return after === 0 ? '0%' : '+∞'
  return `${((after - before) / before) * 100 >= 0 ? '+' : ''}${(((after - before) / before) * 100).toFixed(1)}%`
}

/** Externally-tagged ProgramEdit variant key (e.g. "ReplaceSegment"). */
function editVariant(edit: Record<string, unknown>): string {
  return Object.keys(edit)[0] ?? ''
}

/** Compact structured summary of the edit's parameters (mono detail). Tolerant
 *  of legacy/partial payloads — missing fields are simply omitted. */
function editParamsSummary(edit: Record<string, unknown>): string {
  const variant = editVariant(edit)
  const params = (edit[variant] ?? {}) as Record<string, unknown>
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  switch (variant) {
    case 'ReplaceSegment':
      return `index ${params.index} \u00b7 ${length(params.replacement)} replacement(s)`
    case 'InsertSegments':
      return `at ${params.at} \u00b7 ${length(params.segments)} segment(s)`
    case 'RemoveSegments':
      return `at ${params.at} \u00b7 count ${params.count}`
    case 'SplitMove':
      return `index ${params.index}`
    case 'MergeMoves':
      return `first ${params.first} \u00b7 second ${params.second}`
    case 'MoveWaypoint':
      return `segment_index ${params.segment_index ?? params.waypoint}`
    default:
      return variant
  }
}

// ─── Model contracts ────────────────────────────────────────────────────────

export interface RecommendationState {
  previewing: boolean
  preview: PreviewResponse | null
  applying: boolean
  applied: ApplyResponse | null
  undoing: boolean
  /** Undo-history size as LAST RETURNED by the server. Null until the first
   *  flow response; Undo renders only when > 0 (never local ++/--). */
  historyLength: number | null
  error: string | null
  /** D8: an `unavailable` edit is never applied — Apply is disabled. */
  unavailable: boolean
  /** `historyLength !== null && historyLength > 0` — server-derived gate. */
  canUndo: boolean
}

export interface RecommendationHandlers {
  handlePreview: () => Promise<PreviewResponse | null>
  handleApply: () => Promise<ApplyResponse | null>
  handleUndo: () => Promise<UndoResponse | null>
}

/** The applied feedback the presentations render (plan + health delta).
 *  Health is 0..1 on the wire; display is a whole-percent comparison
 *  ("Health 50% → 62%"), NOT an independent verdict label. */
export interface AppliedRecommendationSummary {
  planId: string
  beforePct: string
  afterPct: string
  improved: boolean
}

/** The preview simulation the presentations render (health delta + metrics).
 *  Same comparison semantics as the applied summary. */
export interface PreviewRecommendationSummary {
  beforePct: string
  afterPct: string
  deltaPct: string
  improved: boolean
  waypointsBefore: string
  waypointsAfter: string
  continuity: 'continuous' | 'broken'
}

export interface RecommendationDerived {
  kindLabel: string
  region: ProblemRegionWire | null
  span: string | null
  strategy: string[] | null
  edit: { variant: string; params: string } | null
  /** Human-readable unavailability reason (design ADR-2); null when the
   *  recommendation is available or the wire carries no reason. M4 renders
   *  it on the card; the model already exposes it for both presentations. */
  reason: string | null
  applied: AppliedRecommendationSummary | null
  preview: PreviewRecommendationSummary | null
}

export interface UseRecommendationResult {
  state: RecommendationState
  handlers: RecommendationHandlers
  derived: RecommendationDerived
}

// ─── The model ──────────────────────────────────────────────────────────────

export function useRecommendation(
  recommendation: RecommendationWire,
  report: AnalysisReportWire | null,
  onRefetch: () => Promise<void> = refetchAnalysis,
): UseRecommendationResult {
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<ApplyResponse | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [historyLength, setHistoryLength] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unavailable = recommendation.status === 'unavailable'
  const canUndo = historyLength !== null && historyLength > 0

  const handlePreview = async (): Promise<PreviewResponse | null> => {
    setPreviewing(true)
    setError(null)
    try {
      const res = await planAnalysisApi.preview(recommendation.id)
      setPreview(res)
      return res
    } catch (err: any) {
      setError(err.message ?? 'Preview failed')
      return null
    } finally {
      setPreviewing(false)
    }
  }

  const handleApply = async (): Promise<ApplyResponse | null> => {
    setApplying(true)
    setError(null)
    try {
      const res = await planAnalysisApi.apply(recommendation.id)
      setApplied(res)
      // history_length is SERVER state — never incremented/decremented locally.
      setHistoryLength(res.history_length)
      // The displayed assessment/narrative/metrics MUST match the APPLIED
      // program — re-fetch the canonical report (never build from preview).
      await onRefetch()
      return res
    } catch (err: any) {
      setError(err.message ?? 'Apply failed')
      return null
    } finally {
      setApplying(false)
    }
  }

  const handleUndo = async (): Promise<UndoResponse | null> => {
    setUndoing(true)
    setError(null)
    try {
      const res = await planAnalysisApi.undo()
      setApplied(null)
      // history_length is SERVER state — read verbatim after the pop.
      setHistoryLength(res.history_length)
      // Display restores the PREVIOUS assessment — re-fetch the report.
      await onRefetch()
      return res
    } catch (err: any) {
      setError(err.message ?? 'Undo failed')
      return null
    } finally {
      setUndoing(false)
    }
  }

  const derived: RecommendationDerived = useMemo(() => {
    const regionId = report ? recommendationRegionId(recommendation, report) : null
    const region =
      regionId !== null ? (report?.problem_regions ?? []).find((r) => r.id === regionId) ?? null : null
    const observation = report?.observations.find(
      (o) => o.id === recommendation.action.target_observation,
    )
    const waypoint = observation ? waypointOf(observation) : null
    const span = region
      ? region.waypoint_end > region.waypoint_start
        ? `wp${region.waypoint_start}\u2013wp${region.waypoint_end}`
        : `wp${region.waypoint_start}`
      : waypoint !== null
        ? `wp${waypoint}`
        : null
    const strategies = region?.explanation?.recommended_strategies
    const strategy = strategies && strategies.length > 0 ? strategies : null

    return {
      kindLabel: recommendationKindLabel(recommendation.action.kind),
      region,
      span,
      strategy,
      edit:
        Object.keys(recommendation.edit).length > 0
          ? { variant: editVariant(recommendation.edit), params: editParamsSummary(recommendation.edit) }
          : null,
      reason: unavailabilityReasonLabel(recommendation.reason),
      applied: applied
        ? {
            planId: applied.plan_id,
            beforePct: healthPercent(applied.health_before),
            afterPct: healthPercent(applied.health_after),
            improved: applied.health_after >= applied.health_before,
          }
        : null,
      preview: preview
        ? {
            beforePct: healthPercent(preview.health_before),
            afterPct: healthPercent(preview.health_after),
            deltaPct: healthDeltaPct(preview.health_before, preview.health_after),
            improved: preview.improvement >= 0,
            waypointsBefore: String(preview.metrics_before.waypoint_count ?? '-'),
            waypointsAfter: String(preview.metrics_after.waypoint_count ?? '-'),
            continuity: preview.continuity ? 'continuous' : 'broken',
          }
        : null,
    }
  }, [recommendation, report, applied, preview])

  return {
    state: { previewing, preview, applying, applied, undoing, historyLength, error, unavailable, canUndo },
    handlers: { handlePreview, handleApply, handleUndo },
    derived,
  }
}
