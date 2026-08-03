/**
 * Mirror de DTOs backend — backend/crates/thalos-api/src/features/plan_analysis/dto.rs
 *
 * PR 7b: the legacy `/plan/analyze` contract types are re-exported from the
 * single compatibility owner (`@/shared/contracts/plan-analysis-compat`) so
 * the store and components keep compiling against the legacy shape while the
 * backend serves the canonical AnalysisReport projection.
 * TODO(change-A): remove compatibility layer — delete these re-exports and
 * restore the canonical wire types when the new UI ships.
 */

export type {
  LegacyAnalysisResponse as PlanAnalysisResponse,
  LegacyWaypointAnalysis as WaypointAnalysisDto,
} from '@/shared/contracts/plan-analysis-compat'

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
