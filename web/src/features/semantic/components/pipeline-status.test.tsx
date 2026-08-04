// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { PipelineStatus, pipelineStagesFromWorkflowState } from './pipeline-status'
import type { WorkflowState } from '@/shared/workflow/types'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'

/**
 * Pipeline status (frontend-pipeline-contracts spec, task 4.3):
 *
 * - The stage mapping moved into `pipeline-status.tsx` and now consumes
 *   `useWorkflowState()` DIRECTLY — `use-pipeline-status.ts` is deleted (single
 *   derivation layer, workflow-state spec "No dual derivation").
 * - The 7 pure-mapping tests below are approval tests carried over verbatim
 *   from `use-pipeline-status.test.ts` (behavior preserved across the move).
 * - One render test proves the component stays reactive to store changes
 *   through the single `useWorkflowState` hook.
 */

const allGood: WorkflowState = {
  robotLoaded: true,
  sceneValid: true,
  programValid: true,
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

  it('Scene passes while Task fails when only the program is incomplete (split flags)', () => {
    const stages = pipelineStagesFromWorkflowState({ ...allGood, programValid: false })
    expect(stage(stages, 'Scene').pass).toBe(true)
    expect(stage(stages, 'Task').pass).toBe(false)
    expect(stage(stages, 'Execute').pass).toBe(false)
  })

  it('Scene and Task both fail when the scene is invalid (artifact chain)', () => {
    const stages = pipelineStagesFromWorkflowState({ ...allGood, sceneValid: false, programValid: false })
    expect(stage(stages, 'Scene').pass).toBe(false)
    expect(stage(stages, 'Task').pass).toBe(false)
    expect(stage(stages, 'Execute').pass).toBe(false)
  })

  it('Compile stays pending and Plan/Execute break when compiled is false', () => {
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

describe('PipelineStatus — single derivation layer (workflow-state spec)', () => {
  beforeEach(() => {
    useSceneStore.getState().reset()
    useSemanticEditor.getState().reset()
    useExecutionStore.setState({ status: 'idle' })
    useAnalysisStore.setState({ summary: null })
  })
  afterEach(() => cleanup())

  it('reflects store changes through useWorkflowState alone (no parallel derivation)', () => {
    // No robot loaded → the Robot stage fails with its guidance message.
    render(<PipelineStatus />)
    expect(screen.getByTitle('Select a robot')).toBeInTheDocument()
    expect(screen.getByText('Robot')).toBeInTheDocument()

    // A robot arrives in the scene → the SAME component flips the Robot stage
    // to pass, and the not-yet-compiled Compile stage surfaces as pending.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
    })
    expect(screen.queryByTitle('Select a robot')).not.toBeInTheDocument()
    expect(screen.getByTitle(/Compile the program/)).toBeInTheDocument()
  })
})
