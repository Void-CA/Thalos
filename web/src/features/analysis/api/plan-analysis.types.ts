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

// ── Plan command preview (PR3 — read-only simulation) ──

/** POST /plan/commands/preview response (backend PreviewResponse). The
 *  simulation applies the recommendation's edit to a CLONE, recompiles and
 *  re-analyzes — the runtime is never mutated. */
export interface PreviewResponse {
  recommendation_id: number
  /** Edit availability (D8): "available" | "unavailable" (omitted when none). */
  status?: 'available' | 'unavailable'
  /** End-effector positions [x, y, z] of the edited trajectory — feeds the
   *  3D overlay (same mechanism as the trajectory view modes). */
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

// ── Plan command undo (PR5 — O(1) via stored inverse) ──

/** POST /plan/commands/undo response (backend UndoResponse). Undo pops the
 *  last applied command and applies its STORED inverse once (no replay),
 *  recompiles and writes the restored plan back to SceneRuntime. Empty
 *  history → 409 empty_command_history. */
export interface UndoResponse {
  /** Restored (previous) plan id — proof the write-back happened. */
  plan_id: string
  /** Health of the plan being undone (the applied plan). */
  health_before: number
  /** Health of the restored (previous) plan. */
  health_after: number
  /** health_after - health_before (negative when the undone command had
   *  improved the plan). */
  improvement: number
  /** Undo-history size after the pop. */
  history_length: number
}
