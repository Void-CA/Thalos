import type { SemanticOp, CompileResponse } from '@/features/semantic/types'
import type { SceneObject } from '@/features/semantic/scene-store'
import type { ExecutionStatus } from '@/features/execution/execution-store'
import type { PlanAnalysisResponse } from '@/features/analysis/api/plan-analysis.types'

/**
 * Snapshot of the domain stores fed into `deriveWorkflowState()`.
 *
 * Mirrors the REAL store fields (workflow-state spec, "Unit-Testable
 * Derivation"): the hook builds it from existing Zustand selectors and the
 * pure function derives every flag from it — no React, no subscriptions.
 *
 * Domain groups match the spec scenario: `{ scene, task, compile, execution,
 * analysis }`. Field notes:
 * - `scene.robotLoaded` — `useSceneStore.data !== null` (viewport store).
 * - `scene.objects` — semantic scene-store objects (`objects.length >= 1`).
 * - `task.operations` — semantic editor operations. `hasMissingFields` is
 *   derived purely from these (lifted from the task editor, design D5).
 * - `compile.dirty` — semantic editor dirty counter (0 = pristine).
 */
export interface WorkflowSnapshot {
  scene: {
    robotLoaded: boolean
    objects: SceneObject[]
  }
  task: {
    operations: SemanticOp[]
  }
  compile: {
    result: CompileResponse | null
    dirty: number
  }
  execution: {
    status: ExecutionStatus
  }
  analysis: {
    summary: PlanAnalysisResponse['summary'] | null
  }
}

/** Single derivation layer for workflow progress (design: WorkflowState). */
export interface WorkflowState {
  robotLoaded: boolean // useSceneStore.data !== null
  taskValid: boolean // operations.length >= 1 && !hasMissingFields && objects.length >= 1
  compiled: boolean // compileResult !== null && !dirty
  analyzed: boolean // useAnalysisStore.summary !== null
  executable: boolean // compiled && execStatus ∈ {ready, running, paused}
  running: boolean // execStatus ∈ {running, paused}
  completed: boolean // execStatus === 'completed'
}

export type WorkflowFlag = keyof WorkflowState
