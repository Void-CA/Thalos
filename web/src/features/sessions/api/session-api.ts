import { apiClient } from '@/shared/api-client'
import type { AnalysisObservationWire } from '@/shared/contracts/analysis-report'

/**
 * Canonical session API surface (S5, session-browser spec, invariant I4).
 *
 * Every method maps 1:1 to an existing backend route
 * (thalos-api/src/features/session/{handler,dto}.rs) and returns the payload
 * verbatim (`r.data`) — this module is the SINGLE client-side data source for
 * sessions. No parallel store, no client-side model: the UI projects these
 * wire shapes (ADR ui-as-domain-projection). React Query is consumed by the
 * components directly over these methods (C2 — the query cache, never a
 * Zustand store).
 */

/** GET /sessions + /sessions/{id} — the backend `SessionResponse` DTO. */
export interface SessionSummary {
  id: number
  plan_id: string
  source: string
  status: string
  started_at: string | null
  paused_at: string | null
  completed_at: string | null
  duration: number
  joint_count: number
  robot_name: string
}

/** GET /sessions/{id}/summary — backend `handler::SessionSummary`. */
export interface SessionStatsSummary {
  session_id: number
  duration: number
  sample_count: number
  joint_count: number
  max_velocity: number[]
  mean_velocity: number[]
  path_length: number
  recording_source: string
  status: string
}

/** GET /sessions/{id}/statistics — `thalos_runtime::telemetry::ExecutionStatistics`. */
export interface ExecutionStatisticsWire {
  duration: number
  sample_count: number
  sample_rate: number
  joint_count: number
  path_length: number
  max_joint_velocity: number[]
  avg_joint_velocity: number[]
  max_tracking_error: number | null
  avg_tracking_error: number | null
  event_count: number
  waypoints_completed: number
}

/** GET /sessions/{id}/trace — `thalos_runtime::MotionTrace` (samples only). */
export interface MotionSampleWire {
  timestamp: number
  joints: number[]
  velocities: number[]
  target_joints: number[] | null
  progress: number
  errors: string[]
}
export interface MotionTraceWire {
  samples: MotionSampleWire[]
}

/** One lifecycle event exactly as the backend serializes it — the
 *  externally-tagged `thalos_runtime::telemetry::ExecutionEvent` enum (S6 fine
 *  typing; previously structural). Exactly ONE variant key is present per
 *  event; timestamps are seconds as f64. The timelineBuilder projects these
 *  verbatim — it never infers events from samples. */
export interface ExecutionEventWire {
  Started?: { timestamp: number }
  Paused?: { timestamp: number }
  Resumed?: { timestamp: number }
  WaypointReached?: { timestamp: number; waypoint: number }
  SegmentCompleted?: { timestamp: number; segment: number }
  Error?: { timestamp: number; message: string }
  Completed?: { timestamp: number }
  Cancelled?: { timestamp: number }
}

/** GET /sessions/{id}/execution-trace — full ExecutionTrace (samples stay
 *  structural; S6 consumes only the events for the timeline). */
export interface ExecutionTraceWire {
  metadata: unknown
  samples: unknown[]
  events: ExecutionEventWire[]
}

/** GET /sessions/{id}/comparison — backend `SessionComparisonResponse`. */
export interface JointErrorMetricsWire {
  rmse: number[]
  max_error: number[]
  avg_error: number[]
}
export interface ComparisonMetricsWire {
  global_rmse: number
  global_max_error: number
  global_avg_error: number
  per_joint: JointErrorMetricsWire
  max_tracking_error: number | null
  avg_tracking_error: number | null
  max_velocity_deviation: number[]
  aligned_count: number
}
export interface SessionComparisonWire {
  metrics: ComparisonMetricsWire
  observations: AnalysisObservationWire[]
  aligned_pair_count: number
}

export const sessionApi = {
  /** GET /api/v1/sessions — all execution sessions, newest context. */
  list: (): Promise<SessionSummary[]> =>
    apiClient.get<SessionSummary[]>('/sessions').then((r) => r.data),

  /** GET /api/v1/sessions/{id} — a single session (same SessionResponse wire). */
  get: (id: number): Promise<SessionSummary> =>
    apiClient.get<SessionSummary>(`/sessions/${id}`).then((r) => r.data),

  /** GET /api/v1/sessions/{id}/summary — computed stats summary of the trace. */
  summary: (id: number): Promise<SessionStatsSummary> =>
    apiClient.get<SessionStatsSummary>(`/sessions/${id}/summary`).then((r) => r.data),

  /** GET /api/v1/sessions/{id}/statistics — TraceAnalyzer execution statistics. */
  statistics: (id: number): Promise<ExecutionStatisticsWire> =>
    apiClient.get<ExecutionStatisticsWire>(`/sessions/${id}/statistics`).then((r) => r.data),

  /** GET /api/v1/sessions/{id}/trace — original MotionTrace (S6 trace chart). */
  trace: (id: number): Promise<MotionTraceWire> =>
    apiClient.get<MotionTraceWire>(`/sessions/${id}/trace`).then((r) => r.data),

  /** GET /api/v1/sessions/{id}/comparison — canonical plan-vs-execution metrics (S6). */
  comparison: (id: number): Promise<SessionComparisonWire> =>
    apiClient.get<SessionComparisonWire>(`/sessions/${id}/comparison`).then((r) => r.data),

  /** GET /api/v1/sessions/{id}/execution-trace — full ExecutionTrace (S6 timeline). */
  executionTrace: (id: number): Promise<ExecutionTraceWire> =>
    apiClient.get<ExecutionTraceWire>(`/sessions/${id}/execution-trace`).then((r) => r.data),

  /** GET /api/v1/sessions/{id}/export — raw trace CSV (S6 export button). */
  exportCsv: (id: number): Promise<string> =>
    apiClient.get<string>(`/sessions/${id}/export`, { responseType: 'text' }).then((r) => r.data),
}
