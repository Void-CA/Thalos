import type { WorkflowSnapshot, WorkflowState, WorkspaceEntry, Capability, WorkflowFlag } from './types'
import type { SemanticOp } from '@/features/semantic/types'
import type { ExecutionStatus } from '@/features/execution/execution-store'

/**
 * Operation validation lifted from the task editor (design: workflow-state
 * spec, `taskValid`). True when any operation references a missing resource —
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
 * Pure derivation of workflow flags from a store snapshot (spec:
 * workflow-state, "Pure Derivation Hook"). No React, no subscriptions, no
 * side effects — every flag is a pure function of the snapshot.
 */
export function deriveWorkflowState(snapshot: WorkflowSnapshot): WorkflowState {
  const compiled =
    snapshot.compile.result !== null && snapshot.compile.dirty === 0
  const status = snapshot.execution.status

  return {
    robotLoaded: snapshot.scene.robotLoaded,
    taskValid:
      snapshot.task.operations.length >= 1 &&
      !hasMissingFields(snapshot.task.operations) &&
      snapshot.scene.objects.length >= 1,
    compiled,
    analyzed: snapshot.analysis.summary !== null,
    executable: compiled && EXECUTABLE_STATUSES.includes(status),
    running: RUNNING_STATUSES.includes(status),
    completed: status === 'completed',
  }
}

// ── Stepper + status derivations (global-stepper spec) ──────────────────────
//
// The stepper is the workflow pipeline (Task → Planning → Execution → Sessions)
// and everything it shows derives from the registry + WorkflowState: stage
// order and labels come from WORKSPACE_REGISTRY, stage states from the flags.
// No per-workspace strings live in the views.

/**
 * Human-readable phrase per workflow flag — the ONLY string source for blocked
 * reasons. Keyed by flag name, not by workspace: the stepper and top-bar reuse
 * it so a blocked stage's message changes with the missing flag instead of
 * being a fixed per-view string.
 */
const FLAG_PHRASES: Record<WorkflowFlag, string> = {
  robotLoaded: 'a loaded robot',
  taskValid: 'a valid task',
  compiled: 'a compiled plan',
  analyzed: 'an analyzed plan',
  executable: 'an executable plan',
  running: 'a running execution',
  completed: 'a completed execution',
}

/** Pipeline capabilities in workflow order (global-stepper spec stage list).
 *  The stepper stages are the registry entries whose capability is a pipeline
 *  step: compile (Task) → optimize (Planning) → execute (Execution) → replay
 *  (Sessions). This excludes the robot root (no capability), the legacy
 *  analysis workspace (no capability — absorbed into planning in slice 6), and
 *  the hidden knowledge workspace ('explain' is a support capability, not a
 *  pipeline stage). Sessions stays a stage even though its top-bar link is
 *  hidden until change 2 — it is the pipeline terminal where completed
 *  executions are reviewed. */
const PIPELINE_CAPABILITIES: readonly Capability[] = ['compile', 'optimize', 'execute', 'replay']

/** Registry entries that form the stepper pipeline, in registry order. */
export function stepperStages(registry: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return registry.filter(
    (entry) =>
      entry.capability !== null && PIPELINE_CAPABILITIES.includes(entry.capability),
  )
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
  if (!state.taskValid) return 'Task incomplete'
  if (!state.compiled) return 'Task modified — recompilation required'
  if (state.running) return 'Plan running'
  if (state.completed) return 'Plan completed — review in Sessions'
  if (state.executable) return 'Plan ready to run'
  if (state.analyzed) return 'Plan analyzed'
  return 'Robot loaded · Task compiled'
}
