import { useSceneStore } from '../scene-store'
import { useSemanticEditor } from '../store'
import { useSceneStore as useViewportStore } from '@/features/viewport/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useSelectedRobot } from '@/features/robots/store'

/** One stage of the Task execution pipeline (design: `{ name, pass, message? }`). */
export interface PipelineStage {
  name: string
  pass: boolean
  /** True when the stage cannot be decided yet (no action has produced a result). */
  pending: boolean
  message?: string
}

/**
 * Derives the 6-stage pipeline status reactively from the stores.
 *
 * Deliberately NOT an imperative `pipelineReady` flag: every stage is computed
 * from current store state, so it can never drift from what the UI actually
 * holds. Stages that depend on an action result that doesn't exist yet
 * (compile/plan) surface as `pending`, not failed.
 */
export function usePipelineStatus(): PipelineStage[] {
  const robotSelected = useSelectedRobot()
  const sceneLoaded = useViewportStore((s) => s.data !== null)
  const objects = useSceneStore((s) => s.objects)
  const operations = useSemanticEditor((s) => s.operations)
  const compileResult = useSemanticEditor((s) => s.result)
  const compileError = useSemanticEditor((s) => s.error)
  const execStatus = useExecutionStore((s) => s.status)

  const robot: PipelineStage = sceneLoaded
    ? { name: 'Robot', pass: true, pending: false }
    : {
        name: 'Robot',
        pass: false,
        pending: !robotSelected,
        message: robotSelected ? 'Loading robot…' : 'Select a robot',
      }

  const scene: PipelineStage = {
    name: 'Scene',
    pass: objects.length >= 1,
    pending: false,
    message: objects.length >= 1 ? undefined : 'Add an object to the Scene',
  }

  const task: PipelineStage = {
    name: 'Task',
    pass: operations.length >= 1,
    pending: false,
    message: operations.length >= 1 ? undefined : 'Add a program operation',
  }

  const compile: PipelineStage = compileResult
    ? {
        name: 'Compile',
        pass: true,
        pending: false,
        message: `${compileResult.metadata.instruction_count} instructions`,
      }
    : compileError
      ? { name: 'Compile', pass: false, pending: false, message: 'Compile failed' }
      : { name: 'Compile', pass: false, pending: true, message: 'Compile the program' }

  const plan: PipelineStage =
    execStatus === 'ready' ||
    execStatus === 'running' ||
    execStatus === 'paused' ||
    execStatus === 'completed'
      ? { name: 'Plan', pass: true, pending: false }
      : execStatus === 'failed'
        ? { name: 'Plan', pass: false, pending: false, message: 'Plan failed' }
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
