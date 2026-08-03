import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import type { WorkflowState } from '@/shared/workflow/types'

/** One stage of the Task execution pipeline (design: `{ name, pass, message? }`). */
export interface PipelineStage {
  name: string
  pass: boolean
  /** True when the stage cannot be decided yet (no action has produced a result). */
  pending: boolean
  message?: string
}

/**
 * Pure mapping WorkflowState → pipeline stages (single derivation layer,
 * workflow-state spec "No dual derivation").
 *
 * Deliberately derived ONLY from `WorkflowState` flags — the hook never reads
 * raw stores. WorkflowState exposes one combined task flag, so the legacy
 * Scene/Task stages both derive from `taskValid`, and the Compile stage no
 * longer distinguishes a compile failure from "not compiled yet" (both surface
 * as pending). This legacy stage list is temporary: pipeline-status is deleted
 * once all consumers use `useWorkflowState` directly (design D7, slice 4).
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
    : { name: 'Plan', pass: false, pending: true, message: 'Run Simulate' }

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
 * Re-sourced pipeline status (design D7): a thin wrapper over the single
 * `useWorkflowState()` derivation. It no longer derives robot/scene/task/
 * compile stages from raw stores.
 */
export function usePipelineStatus(): PipelineStage[] {
  return pipelineStagesFromWorkflowState(useWorkflowState())
}
