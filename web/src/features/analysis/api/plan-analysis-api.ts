import { apiClient } from '@/shared/api-client'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import type { ProgramEditWire } from '@/shared/contracts/program-edit'
import type { PreviewResponse, ApplyResponse, UndoResponse } from './plan-analysis.types'

/**
 * domain-areas S4: `/plan/analyze` returns the canonical AnalysisReport
 * projection (observations/actions/metrics/summary). The compatibility layer
 * was removed — components and stores consume the wire shape directly
 * (ADR: ui-as-domain-projection).
 */
export const planAnalysisApi = {
  analyze: (planId?: string): Promise<AnalysisReportWire> =>
    apiClient
      .post<AnalysisReportWire>('/plan/analyze', { plan_id: planId ?? null })
      .then(r => r.data),

  /**
   * POST /plan/commands/preview (PR3) — READ-ONLY simulation of a
   * recommendation: the backend applies the edit to a clone, recompiles and
   * re-analyzes. The runtime is never mutated.
   */
  preview: (recommendationId: number): Promise<PreviewResponse> =>
    apiClient
      .post<PreviewResponse>('/plan/commands/preview', { recommendation_id: recommendationId })
      .then(r => r.data),

  /**
   * POST /plan/commands/apply (PR4) — WRITE-BACK: the backend executes the
   * recommendation's edit, recompiles and replaces the active plan in
   * SceneRuntime (feature-flagged scene-writeback). Preview is NOT a
   * prerequisite. The inverse is stored server-side for PR5's undo.
   */
  apply: (recommendationId: number): Promise<ApplyResponse> =>
    apiClient
      .post<ApplyResponse>('/plan/commands/apply', { recommendation_id: recommendationId })
      .then(r => r.data),

  /**
   * POST /plan/commands/undo (PR5) — O(1): pops the last applied command and
   * applies its STORED inverse (no replay), recompiles and writes the
   * restored plan back to SceneRuntime (feature-flagged scene-writeback).
   * Empty history → 409 empty_command_history.
   */
  undo: (): Promise<UndoResponse> =>
    apiClient.post<UndoResponse>('/plan/commands/undo', {}).then(r => r.data),

  /**
   * POST /plan/program/edit (CDD step 3) — free-form program edit: applies a
   * RAW `ProgramEdit` (semantic command language, design D1) with the same
   * backend cycle as apply (edit.apply → recompile → re-analyze → write-back).
   * No recommendation_id — the edit is built by the UI from a segment change.
   */
  editProgram: (edit: ProgramEditWire): Promise<ApplyResponse> =>
    apiClient.post<ApplyResponse>('/plan/program/edit', { edit }).then(r => r.data),
}
