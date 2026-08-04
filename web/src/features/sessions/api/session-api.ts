import { apiClient } from '@/shared/api-client'

/**
 * Session summary — the minimal list wire for `GET /api/v1/sessions`
 * (backend `SessionResponse` DTO, thalos-api/src/features/session/dto.rs).
 *
 * Typed faithfully to the real backend response: id, plan_id, source, status,
 * started_at/paused_at/completed_at (RFC3339 or null), duration (seconds),
 * joint_count and robot_name. This is the S5 minimal list contract only —
 * detail/trace/replay/export fields belong to the future session browser
 * change and are intentionally NOT modeled here.
 */
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

export const sessionApi = {
  /** GET /api/v1/sessions — all execution sessions, newest context. */
  list: () => apiClient.get<SessionSummary[]>('/sessions').then((r) => r.data),
}
