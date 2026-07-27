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
