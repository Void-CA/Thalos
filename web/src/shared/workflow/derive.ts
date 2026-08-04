import type { WorkflowSnapshot, WorkflowState, WorkspaceEntry, WorkflowFlag } from './types'
import type { SemanticOp, PoseDef } from '@/shared/contracts'
import type { ExecutionStatus } from '@/features/execution/execution-store'

/**
 * Operation validation lifted from the task editor (design: workflow-state
 * spec, `programValid`). True when any operation references a missing resource —
 * a pick without an object, a place without object/destination, a move_to
 * without destination, or a wait with a zero duration.
 */
export function hasMissingFields(operations: readonly SemanticOp[]): boolean {
  return operations.some(
    (op) =>
      (op.type === 'pick' && !op.object) ||
      (op.type === 'place' && (!op.object || !op.destination)) ||
      (op.type === 'move_to' && !op.destination) ||
      (op.type === 'wait' &&
        (!op.duration || (op.duration.secs === 0 && op.duration.nanos === 0))),
  )
}

/** execStatus values that count as "a plan is loaded and runnable". */
const EXECUTABLE_STATUSES: readonly ExecutionStatus[] = ['ready', 'running', 'paused']
/** execStatus values that count as "execution is in progress". */
const RUNNING_STATUSES: readonly ExecutionStatus[] = ['running', 'paused']

/**
 * Home-pose validity (workflow-state spec derivation table: `sceneValid` =
 * `objects.length >= 1 && validHomePose`). A pose is valid when both vectors
 * are structurally complete and finite — guards against NaN / partial home
 * poses leaking in from the scene editor.
 */
export function isValidHomePose(pose: PoseDef | null | undefined): boolean {
  if (!pose) return false
  const { position, orientation } = pose
  return (
    position.length === 3 &&
    orientation.length === 4 &&
    position.every((v) => Number.isFinite(v)) &&
    orientation.every((v) => Number.isFinite(v))
  )
}

/**
 * Pure derivation of workflow flags from a store snapshot (spec:
 * workflow-state, "Pure Derivation Hook"). No React, no subscriptions, no
 * side effects — every flag is a pure function of the snapshot.
 *
 * The flags form the artifact chain (R2: RobotModel → Scene → SemanticProgram
 * → MotionPlan → Runtime), so each downstream flag requires the upstream one:
 * `sceneValid ⇒ robotLoaded`, `programValid ⇒ sceneValid`,
 * `compiled ⇒ programValid`, `executable ⇒ compiled` — impossible states are
 * impossible by construction (tasks.md C1). The scene/program split keeps the
 * two validities separately meaningful: a scene can be valid while the program
 * is still incomplete.
 */
export function deriveWorkflowState(snapshot: WorkflowSnapshot): WorkflowState {
  const sceneValid =
    snapshot.scene.robotLoaded &&
    snapshot.scene.objects.length >= 1 &&
    snapshot.scene.validHomePose
  const programValid =
    sceneValid &&
    snapshot.task.operations.length >= 1 &&
    !hasMissingFields(snapshot.task.operations)
  const compiled =
    programValid &&
    snapshot.compile.result !== null &&
    snapshot.compile.dirty === 0
  const status = snapshot.execution.status

  return {
    robotLoaded: snapshot.scene.robotLoaded,
    sceneValid,
    programValid,
    compiled,
    analyzed: snapshot.analysis.summary !== null,
    executable: compiled && EXECUTABLE_STATUSES.includes(status),
    running: RUNNING_STATUSES.includes(status),
    completed: status === 'completed',
  }
}

// ── Stepper + status derivations (global-stepper spec) ──────────────────────
//
// The stepper is the workflow pipeline (Robot → Escena → Programación →
// Planificación → Ejecución → Sesiones) and everything it shows derives from
// the registry + WorkflowState: stage order and labels come from
// WORKSPACE_REGISTRY (the `stage` field), stage states from the flags. No
// per-workspace strings live in the views.

/**
 * Human-readable phrase per workflow flag — the ONLY string source for blocked
 * reasons. Keyed by flag name, not by workspace: the stepper and top-bar reuse
 * it so a blocked stage's message changes with the missing flag instead of
 * being a fixed per-view string.
 */
const FLAG_PHRASES: Record<WorkflowFlag, string> = {
  robotLoaded: 'a loaded robot',
  sceneValid: 'a valid scene',
  programValid: 'a valid program',
  compiled: 'a compiled plan',
  analyzed: 'an analyzed plan',
  executable: 'an executable plan',
  running: 'a running execution',
  completed: 'a completed execution',
}

/** Registry entries that form the stepper pipeline, ordered by the registry
 *  `stage` field — the domain pipeline position (Robot=1 … Sesiones=6). This
 *  replaced the old PIPELINE_CAPABILITIES capability filter, which excluded
 *  Robot and Escena: the stepper is a PROJECTION of the area registry (ADR
 *  ui-as-domain-projection, criterion C1), never a parallel stage list. Areas
 *  with `stage: null` (knowledge; Configuración when it lands in S5 —
 *  area-configuration spec "not a stepper stage") are not pipeline stages.
 *  NOTE (C2, for verify): `stepperIndex` is currently redundant — it equals
 *  `stage` on every pipeline area; `stage` is the canonical order key. */
export function stepperStages(registry: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return registry
    .filter((entry): entry is WorkspaceEntry & { stage: number } => entry.stage !== null)
    .sort((a, b) => a.stage - b.stage)
}

/** Per-stage state in the stepper (global-stepper spec: passed/current/pending/blocked). */
export type StageState = 'passed' | 'current' | 'pending' | 'blocked'

export interface StepperStage {
  entry: WorkspaceEntry
  state: StageState
  /** Derived from the first missing requirement — null when the stage is not blocked. */
  reason: string | null
}

/**
 * First missing requirement of a registry entry, rendered from the flag name
 * (never a per-workspace hardcoded string). Returns null when every
 * requirement is met.
 */
export function requirementReason(
  entry: Pick<WorkspaceEntry, 'requires'>,
  flags: WorkflowState,
): string | null {
  const missing = entry.requires.find((flag) => !flags[flag])
  if (!missing) return null
  return `Requires ${FLAG_PHRASES[missing]}`
}

/**
 * Pure derivation of the stepper stages (global-stepper spec, "Workflow-Driven
 * Stages"). For every pipeline stage:
 * - the active route is `current`;
 * - a stage with an unmet requirement is `blocked` (reason from the missing flag);
 *   Robot (requires []) is never blocked — it is the stage-1 entry point;
 * - a stage that already produced its output, or sits before the current one in
 *   pipeline order, is `passed`;
 * - anything else is `pending` (future stage, requirements met).
 */
export function deriveStepperStages(
  flags: WorkflowState,
  activePath: string,
  registry: readonly WorkspaceEntry[],
): StepperStage[] {
  const stages = stepperStages(registry)
  const activeIndex = stages.findIndex((entry) => entry.path === activePath)

  return stages.map((entry, index) => {
    if (entry.path === activePath) {
      return { entry, state: 'current', reason: null }
    }
    const reason = requirementReason(entry, flags)
    if (reason) {
      return { entry, state: 'blocked', reason }
    }
    const produced = entry.produces !== null && flags[entry.produces]
    const beforeCurrent = activeIndex !== -1 && index < activeIndex
    if (produced || beforeCurrent) {
      return { entry, state: 'passed', reason: null }
    }
    return { entry, state: 'pending', reason: null }
  })
}

/**
 * Short status line derived from the workflow flags (S2: the status bar must
 * reflect the real workflow state, never a static string). Single line,
 * consistent with `useWorkflowState`.
 */
export function deriveStatusMessage(state: WorkflowState): string {
  if (!state.robotLoaded) return 'No robot loaded'
  if (!state.sceneValid) return 'Scene incomplete'
  if (!state.programValid) return 'Task incomplete'
  if (!state.compiled) return 'Task modified — recompilation required'
  if (state.running) return 'Plan running'
  if (state.completed) return 'Plan completed — review in Sessions'
  if (state.executable) return 'Plan ready to run'
  if (state.analyzed) return 'Plan analyzed'
  return 'Robot loaded · Task compiled'
}
