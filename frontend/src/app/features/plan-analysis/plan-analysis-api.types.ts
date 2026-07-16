// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/plan_analysis/dto.rs

export interface PlanAnalysisRequest {
  planId?: string;
}

export interface PlanAnalysisResponse {
  summary: SummaryDto;
  metrics: MetricsDto;
  findings: FindingDto[];
  recommendations: RecommendationDto[];
}

export interface SummaryDto {
  status: 'ok' | 'warning' | 'error';
  score: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Invalid';
  message: string;
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
