import type { SemanticOp } from '@/shared/contracts'
import type { CompileResponse } from '@/features/semantic/types'
import type { SceneObject } from '@/features/scene/store'
import type { ExecutionStatus } from '@/features/execution/execution-store'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

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
 * - `scene.objects` — domain scene-store objects (`objects.length >= 1`).
 * - `scene.validHomePose` — home-pose validity, computed by the hook via
 *   `isValidHomePose()` from the domain scene-store `homePose`.
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
    report: AnalysisReportWire | null
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

/**
 * The seven domain artifacts of the pipeline chain (workflow-state spec R2 —
 * the `ArtifactRef` variants in thalos-core). Typed `consumes`/`produces` for
 * registry entries (design D1, tasks S1.8).
 */
export type ArtifactKind =
  | 'URDF'
  | 'RobotModel'
  | 'Scene'
  | 'SemanticProgram'
  | 'MotionPlan'
  | 'Runtime'
  | 'ExecutionSession'

/** Stable workspace identifier — key for the view registry. */
export type WorkspaceName =
  | 'robot'
  | 'scene'
  | 'task'
  | 'planning'
  | 'execution'
  | 'sessions'
  | 'knowledge'
  | 'configuration'
  | 'analysis'

/**
 * Declarative registry entry (design: WorkspaceEntry contract).
 * The single source of truth for navigation, guards, stepper and breadcrumbs.
 */
export interface WorkspaceEntry {
  /** Router path for this workspace ('/' for the landing). */
  path: string
  /** Stable workspace identifier — key for the view registry. */
  workspace: WorkspaceName
  /** Human-readable nav label (domain vocabulary, navigation-router spec). */
  label: string
  /** Prerequisites (WorkflowState flags) to access this workspace. */
  requires: WorkflowFlag[]
  /** Flag this workspace enables (null = terminal/read-only workspace). */
  produces: WorkflowFlag | null
  /** Primary capability (null = no exclusive capability; invariant #7). */
  capability: Capability | null
  /** True while the workspace has no delivered content yet (nav link suppressed). */
  hidden: boolean
  /** Domain artifact this area consumes (R2 artifact chain; design D1). */
  consumes: ArtifactKind | null
  /** Domain artifact this area produces (R2 artifact chain; design D1). */
  producesArtifact: ArtifactKind | null
  /** Pipeline stage position (1-6) or null for non-stage areas (Robot = 1 marker). */
  stage: number | null
  /** Explicit position in the stepper (consumed from S3; carried as data in S1). */
  stepperIndex?: number
  /**
   * Navigation kind (auxiliary-tools-navigation spec, design D4): 'stage' for
   * pipeline areas (rendered by the stepper), 'tool' for auxiliary tools
   * (grouped after a divider in the top-bar, excluded from the stepper).
   * Default 'stage' — existing entries without an explicit kind stay stages.
   */
  kind?: 'stage' | 'tool'
}

/**
 * D1 — the registry describes domain AREAS, not views. `Area` is the
 * domain-area view of a registry entry (design D1: consumes/produces artifacts,
 * stage, stepperIndex, guards).
 *
 * S3.6 status: the flat `requires`/`produces` fields ARE the typed guards —
 * every consumer (stepper, TopBar, GuardedRoute, derive, registry tests) draws
 * from this single source, and the pipeline graph is contiguous
 * (`produces(area_i) === consumes(area_{i+1})`, pinned by registry.test.ts
 * S3.5). The design's nested `guards.{}` shape was DEFERRED: it would be a
 * pure restructuring with no derivation gain and a wide ripple
 * (top-bar/guarded-route/tests) — flagged as a deviation for verify.
 */
export type Area = WorkspaceEntry
