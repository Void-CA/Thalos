// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/plan_analysis/dto.rs

export interface PlanAnalysisRequest {
  planId?: string;
}

export interface PlanAnalysisResponse {
  summary: SummaryDto;
  metrics: MetricsDto;
  waypoints: WaypointAnalysisDto[];
  findings: FindingDto[];
  recommendations: RecommendationDto[];
  problem_regions?: ProblemRegionDto[];
  health_score?: number;
}

export interface ProblemRegionDto {
  id: number;
  kind: string;
  severity: string;
  waypoint_start: number;
  waypoint_end: number;
  waypoint_count: number;
  metrics?: RegionMetricsDto;
  explanation: ExplanationDto;
  confidence?: number;
  recommended_strategies?: string[];
}

export interface RegionMetricsDto {
  waypoint_count: number;
  average_value: number | null;
  min_value: number | null;
  max_value: number | null;
  error_count: number;
  warning_count: number;
}

export interface ExplanationDto {
  cause: string;
  consequence: string;
  recommended_strategies: string[];
  confidence: number;
}

export interface SummaryDto {
  status: 'ok' | 'warning' | 'error';
  score: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Invalid';
  message: string;
}

export interface WaypointAnalysisDto {
  index: number;
  severity: 'good' | 'warning' | 'critical';
  manipulability: number | null;
  singularity_state: 'normal' | 'near' | 'singular' | null;
  clearance: number | null;
}

export interface MetricsDto {
  duration: number;
  waypoint_count: number;
  average_manipulability: number | null;
  near_singular_count: number;
  singular_count: number;
  min_collision_distance: number | null;
  has_collisions: boolean;
}

export interface FindingDto {
  kind: string;
  severity: 'info' | 'warning' | 'error';
  waypoint: number | null;
  message: string;
  value: number | null;
}

export interface RecommendationDto {
  kind: string;
  message: string;
  impact: 'low' | 'medium' | 'high';
  waypoint: number | null;
}

// ── Alternatives (M5 — Expert Planning Assistant) ──

export interface AlternativesResponse {
  original_score: number;
  original_breakdown: MetricBreakdownItem[];
  alternatives: RankedAlternativeDto[];
  total_candidates: number;
}

export interface MetricBreakdownItem {
  name: string;
  value: number;
}

export interface PerturbationDto {
  waypoint: number;
  joint: number;
  delta: number;
}

export interface MetricBreakdownDto {
  name: string;
  original: number;
  candidate: number;
}

export interface RankedAlternativeDto {
  rank: number;
  source_waypoint: number;
  perturbations: PerturbationDto[];
  score: number;
  original_score: number;
  delta_score: number;
  improvement_percent: number;
  improvements: string[];
  breakdown: MetricBreakdownDto[];
}
