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
