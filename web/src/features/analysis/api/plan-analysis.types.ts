/** Mirror de DTOs backend — backend/crates/thalos-api/src/features/plan_analysis/dto.rs */

export interface WaypointAnalysisDto {
  index: number
  severity: 'good' | 'warning' | 'critical'
  manipulability: number | null
  singularity_state: 'normal' | 'near' | 'singular' | null
  clearance: number | null
}

export interface PlanAnalysisResponse {
  summary: {
    status: 'ok' | 'warning' | 'error'
    score: number
    grade: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Invalid'
    message: string
  }
  metrics: {
    duration: number
    waypoint_count: number
    average_manipulability: number | null
    near_singular_count: number
    singular_count: number
    min_collision_distance: number | null
    has_collisions: boolean
  }
  waypoints: WaypointAnalysisDto[]
  findings: { kind: string; severity: string; waypoint: number | null; message: string; value: number | null }[]
  recommendations: { kind: string; message: string; impact: string; waypoint: number | null }[]
  problem_regions?: unknown[]
  health_score?: number
}

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
