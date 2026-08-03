import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import type { WorkflowState } from '@/shared/workflow/types'

/** One stage of the workflow progress display (design: `{ name, pass, message? }`). */
export interface PipelineStage {
  name: string
  pass: boolean
  /** True when the stage cannot be decided yet (no action has produced a result). */
  pending: boolean
  message?: string
}

/**
 * Pure mapping WorkflowState → workflow stages (frontend-pipeline-contracts
 * spec). The ONLY derivation layer is `useWorkflowState()` — this function
 * never reads raw stores (workflow-state spec, "No dual derivation").
 *
 * WorkflowState exposes one combined task flag, so the legacy Scene/Task
 * stages both derive from `taskValid`; the Compile stage surfaces a missing or
 * stale compile as pending. Stages map to the spec flags: `robotLoaded`,
 * `taskValid`, `compiled`, `executable`, `running`, `completed`.
 */
export function pipelineStagesFromWorkflowState(state: WorkflowState): PipelineStage[] {
  const robot: PipelineStage = state.robotLoaded
    ? { name: 'Robot', pass: true, pending: false }
    : { name: 'Robot', pass: false, pending: false, message: 'Select a robot' }

  const scene: PipelineStage = {
    name: 'Scene',
    pass: state.taskValid,
    pending: false,
    message: state.taskValid ? undefined : 'Complete the Scene',
  }

  const task: PipelineStage = {
    name: 'Task',
    pass: state.taskValid,
    pending: false,
    message: state.taskValid ? undefined : 'Define a program',
  }

  const compile: PipelineStage = state.compiled
    ? { name: 'Compile', pass: true, pending: false }
    : { name: 'Compile', pass: false, pending: true, message: 'Compile the program' }

  const plan: PipelineStage = state.executable || state.completed
    ? { name: 'Plan', pass: true, pending: false }
    : { name: 'Plan', pass: false, pending: true, message: 'Send the plan to Execution' }

  const priorOk = robot.pass && scene.pass && task.pass && compile.pass && plan.pass
  const execute: PipelineStage = priorOk
    ? { name: 'Execute', pass: true, pending: false }
    : {
        name: 'Execute',
        pass: false,
        pending: true,
        message: 'Complete the stages above',
      }

  return [robot, scene, task, compile, plan, execute]
}

/**
 * Compact workflow progress indicator: `Robot ✓ Scene ✓ Task ✓ Compile ✓
 * Plan ✓ Execute`. Consumes `useWorkflowState()` DIRECTLY — the single
 * derivation layer (design D7: re-source then delete the old hook).
 */
export function PipelineStatus() {
  const stages = pipelineStagesFromWorkflowState(useWorkflowState())

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {stages.map((stage) => (
        <span
          key={stage.name}
          className="inline-flex items-center gap-1 text-[10px] font-medium"
          title={stage.message}
        >
          {stage.pass ? (
            <span className="text-green-500">✓</span>
          ) : stage.pending ? (
            <span className="text-muted-foreground">•</span>
          ) : (
            <span className="text-red-400">✗</span>
          )}
          <span
            className={
              stage.pass
                ? 'text-green-500'
                : stage.pending
                  ? 'text-muted-foreground'
                  : 'text-red-400'
            }
          >
            {stage.name}
          </span>
        </span>
      ))}
    </div>
  )
}
