import { describe, it, expect } from 'vitest'
import { pipelineStagesFromWorkflowState } from './use-pipeline-status'
import type { WorkflowState } from '@/shared/workflow/types'

const allGood: WorkflowState = {
  robotLoaded: true,
  taskValid: true,
  compiled: true,
  analyzed: true,
  executable: true,
  running: false,
  completed: false,
}

function stage(stages: ReturnType<typeof pipelineStagesFromWorkflowState>, name: string) {
  const found = stages.find((s) => s.name === name)
  if (!found) throw new Error(`stage ${name} not found`)
  return found
}

describe('pipelineStagesFromWorkflowState — stages derive ONLY from WorkflowState flags', () => {
  it('keeps the 6-stage order (Robot → Scene → Task → Compile → Plan → Execute)', () => {
    expect(pipelineStagesFromWorkflowState(allGood).map((s) => s.name)).toEqual([
      'Robot',
      'Scene',
      'Task',
      'Compile',
      'Plan',
      'Execute',
    ])
  })

  it('marks every stage passed for an all-good state', () => {
    const stages = pipelineStagesFromWorkflowState(allGood)
    expect(stages.every((s) => s.pass)).toBe(true)
    expect(stages.every((s) => !s.pending)).toBe(true)
  })

  it('Robot fails and the chain breaks when no robot is loaded', () => {
    const stages = pipelineStagesFromWorkflowState({ ...allGood, robotLoaded: false })
    expect(stage(stages, 'Robot').pass).toBe(false)
    expect(stage(stages, 'Robot').message).toBe('Select a robot')
    expect(stage(stages, 'Execute').pass).toBe(false)
  })

  it('Scene and Task fail when the task is not valid (combined flag)', () => {
    const stages = pipelineStagesFromWorkflowState({ ...allGood, taskValid: false })
    expect(stage(stages, 'Scene').pass).toBe(false)
    expect(stage(stages, 'Task').pass).toBe(false)
    expect(stage(stages, 'Execute').pass).toBe(false)
  })

  it('Compile stays pending and Plan/Execute break when compiled is false', () => {
    // executable is derived from compiled (deriveWorkflowState), so a not-
    // compiled state can never be executable — keep the fixture consistent.
    const stages = pipelineStagesFromWorkflowState({ ...allGood, compiled: false, executable: false })
    expect(stage(stages, 'Compile').pass).toBe(false)
    expect(stage(stages, 'Compile').pending).toBe(true)
    expect(stage(stages, 'Plan').pass).toBe(false)
    expect(stage(stages, 'Execute').pass).toBe(false)
  })

  it('Plan passes via completed even when not executable', () => {
    const stages = pipelineStagesFromWorkflowState({ ...allGood, executable: false, completed: true })
    expect(stage(stages, 'Plan').pass).toBe(true)
  })

  it('Plan is pending when nothing is loaded or running', () => {
    const stages = pipelineStagesFromWorkflowState({ ...allGood, executable: false, completed: false })
    expect(stage(stages, 'Plan').pass).toBe(false)
    expect(stage(stages, 'Plan').pending).toBe(true)
  })
})
