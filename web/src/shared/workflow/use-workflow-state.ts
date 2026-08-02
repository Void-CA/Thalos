import { useSceneStore } from '@/features/viewport/store'
import { useSceneStore as useSemanticSceneStore } from '@/features/semantic/scene-store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import { deriveWorkflowState } from './derive'
import type { WorkflowState } from './types'

/**
 * Selector hook — the single derivation layer for workflow progress
 * (spec: workflow-state, "Pure Derivation Hook").
 *
 * Subscribes to the existing stores with fine-grained selectors and forwards
 * the snapshot to the pure `deriveWorkflowState()`. Read-only: introduces no
 * new state and no side effects; every flag is a pure function of store state.
 */
export function useWorkflowState(): WorkflowState {
  return deriveWorkflowState({
    scene: {
      robotLoaded: useSceneStore((s) => s.data !== null),
      objects: useSemanticSceneStore((s) => s.objects),
    },
    task: {
      operations: useSemanticEditor((s) => s.operations),
    },
    compile: {
      result: useSemanticEditor((s) => s.result),
      dirty: useSemanticEditor((s) => s.dirty),
    },
    execution: {
      status: useExecutionStore((s) => s.status),
    },
    analysis: {
      summary: useAnalysisStore((s) => s.summary),
    },
  })
}
