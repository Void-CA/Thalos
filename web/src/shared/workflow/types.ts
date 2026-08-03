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
 * - `scene.validHomePose` — home-pose validity, computed by the hook via
 *   `isValidHomePose()` from the semantic scene-store `homePose`.
 * - `task.operations` — semantic editor operations. `hasMissingFields` is
 *   derived purely from these (lifted from the task editor, design D5).
 * - `compile.dirty` — semantic editor dirty counter (0 = pristine).
 */
export interface WorkflowSnapshot {
  scene: {
    robotLoaded: boolean
    objects: SceneObject[]
    validHomePose: boolean
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

/**
 * Single derivation layer for workflow progress (design D2: WorkflowState
 * COMPLETELY derived). Flags form the artifact chain (R2: RobotModel → Scene →
 * SemanticProgram → MotionPlan → Runtime), so each downstream flag requires the
 * upstream one — impossible states are impossible by construction (tasks C1).
 */
export interface WorkflowState {
  robotLoaded: boolean // useSceneStore.data !== null
  sceneValid: boolean // scene artifact valid: robotLoaded && objects >= 1 && validHomePose
  programValid: boolean // semantic program valid: sceneValid && operations >= 1 && !hasMissingFields
  compiled: boolean // motion plan exists: programValid && compileResult !== null && !dirty
  analyzed: boolean // analysis report exists: useAnalysisStore.summary !== null
  executable: boolean // runtime can start: compiled && execStatus ∈ {ready, running, paused}
  running: boolean // runtime active: execStatus ∈ {running, paused}
  completed: boolean // execution session exists: execStatus === 'completed'
}

export type WorkflowFlag = keyof WorkflowState

/** Primary capability a workspace owns (invariant #7: exactly one workspace per capability). */
export type Capability = 'compile' | 'optimize' | 'execute' | 'replay' | 'explain'

/** Stable workspace identifier — key for the view registry. */
export type WorkspaceName =
  | 'robot'
  | 'task'
  | 'planning'
  | 'execution'
  | 'sessions'
  | 'knowledge'

/**
 * Declarative registry entry (design: WorkspaceEntry contract).
 * The single source of truth for navigation, guards, stepper and breadcrumbs.
 */
export interface WorkspaceEntry {
  /** Router path for this workspace ('/' for the landing). */
  path: string
  /** Stable workspace identifier — key for the view registry. */
  workspace: WorkspaceName
  /** Human-readable nav label. */
  label: string
  /** Prerequisites (WorkflowState flags) to access this workspace. */
  requires: WorkflowFlag[]
  /** Flag this workspace enables (null = terminal/read-only workspace). */
  produces: WorkflowFlag | null
  /** Primary capability (null = no exclusive capability; invariant #7). */
  capability: Capability | null
  /** True while the workspace has no delivered content yet (nav link suppressed). */
  hidden: boolean
}
