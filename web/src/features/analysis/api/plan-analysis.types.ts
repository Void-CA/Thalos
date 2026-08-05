/**
 * Mirror de DTOs backend — backend/crates/thalos-api/src/features/plan_analysis/dto.rs
 *
 * domain-areas S4: the compatibility layer was removed. The canonical
 * `AnalysisReportWire` types live in `@/shared/contracts/analysis-report` and
 * are the ONLY shape the analysis feature consumes (ADR:
 * ui-as-domain-projection).
 */

export type {
  AnalysisReportWire as PlanAnalysisResponse,
  AnalysisObservationWire,
  AnalysisActionWire,
  ProblemRegionWire,
} from '@/shared/contracts/analysis-report'

// ── Optimization (M9 / M10) ──

export interface OptimizeResponse {
  health_before: number
  health_after: number
  operators_applied: OperatorApplied[]
  metrics: MetricsComparison
  optimized_positions: number[][]  // [[x,y,z], ...] for 3D overlay
}

export interface OperatorApplied {
  id: string
  family: string
  status: 'applied' | 'rejected' | 'failed'
}

export interface MetricsComparison {
  manipulability_before: number
  manipulability_after: number
  joint_margin_before: number
  joint_margin_after: number
  max_velocity_before: number
  max_velocity_after: number
  max_segment_error_before: number
  max_segment_error_after: number
}

// ── Plan command preview (PR3 — read-only simulation) ──

/** POST /plan/commands/preview response (backend PreviewResponse). The
 *  simulation applies the recommendation's edit to a CLONE, recompiles and
 *  re-analyzes — the runtime is never mutated. */
export interface PreviewResponse {
  recommendation_id: number
  /** Edit availability (D8): "available" | "unavailable" (omitted when none). */
  status?: 'available' | 'unavailable'
  /** End-effector positions [x, y, z] of the edited trajectory — feeds the
   *  3D overlay (same pattern as OptimizeResponse.optimized_positions). */
  waypoints: number[][]
  metrics_before: Record<string, number>
  metrics_after: Record<string, number>
  health_before: number
  health_after: number
  /** health_after - health_before (negative = degrades). */
  improvement: number
  continuity: boolean
}

// ── Plan command apply (PR4 — scene write-back) ──

/** POST /plan/commands/apply response (backend ApplyResponse). The edit is
 *  executed against the semantic program, recompiled and written back to
 *  SceneRuntime via replace_active_plan; the inverse is stored in memory for
 *  PR5's O(1) undo. */
export interface ApplyResponse {
  recommendation_id: number
  /** Edit availability (D8). An unavailable edit is REJECTED by the backend
   *  (409 recommendation_unavailable) — never sent from the row. */
  status?: 'available' | 'unavailable'
  /** New active plan id — proof the write-back happened. */
  plan_id: string
  health_before: number
  health_after: number
  /** health_after - health_before (negative = degrades). */
  improvement: number
  /** Undo-history size (inverses stored for PR5). */
  history_length: number
}
