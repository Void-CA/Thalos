import type { WorkflowSnapshot, WorkflowState } from './types'
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
