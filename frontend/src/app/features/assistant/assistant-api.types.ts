export interface DecisionStepDto {
  step: number;
  description: string;
  rationale: string;
  data_snapshot: string;
}

export interface ExplainEntryDto {
  id: string;
  step: number;
  decision: string;
  rationale: string;
  confidence: number;
  alternatives: string[];
  selected: boolean;
  timestamp: string;
  chain: DecisionStepDto[];
}

export interface ExplainResponse {
  entries: ExplainEntryDto[];
}

export interface OptimizeRequest {
  objectives: { id: string; weight: number; enabled: boolean }[];
}

export interface OptimizationObjectiveDto {
  id: string;
  label: string;
  weight: number;
  current_value: number;
  target_value: number;
  unit: string;
  enabled: boolean;
}

export interface ParetoSolutionDto {
  id: number;
  values: Record<string, number>;
  rank: number;
}

export interface OptimizeResponse {
  objectives: OptimizationObjectiveDto[];
  pareto_front: ParetoSolutionDto[];
  iterations: number;
  converged: boolean;
}

export interface LearnedPatternDto {
  id: string;
  pattern: string;
  confidence: number;
  occurrences: number;
  impact: string;
  category: 'efficiency' | 'safety' | 'precision' | 'reliability';
  last_observed: string;
}

export interface ExecutionInsightDto {
  metric: string;
  average: number;
  best: number;
  worst: number;
  trend: 'improving' | 'stable' | 'degrading';
  recommendation: string;
}

export interface LearnResponse {
  patterns: LearnedPatternDto[];
  insights: ExecutionInsightDto[];
}

export interface AdaptationEventDto {
  id: string;
  timestamp: string;
  failure_type: string;
  severity: 'info' | 'warning' | 'critical';
  adaptation: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  recovery_time_ms: number;
}

export interface AdaptResponse {
  events: AdaptationEventDto[];
}

export interface AdaptResolveRequest {
  id: string;
}
