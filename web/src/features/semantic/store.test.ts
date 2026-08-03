import { describe, it, expect, beforeEach } from 'vitest'
import { useSemanticEditor } from './store'
import { useDomainSceneStore } from '@/features/scene/store'
import { deriveWorkflowState, isValidHomePose } from '@/shared/workflow/derive'
import type { CompileResponse } from './types'

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const op = { type: 'pick' as const, origin: 'op_new', object: 'bolt-1' }

beforeEach(() => {
  // Restore the canonical sample program (result cleared, dirty reset).
  useSemanticEditor.getState().reset()
})

/** Live snapshot of the real stores — the exact wiring useWorkflowState builds. */
function workflowSnapshot() {
  return {
    scene: {
      robotLoaded: true,
      objects: useDomainSceneStore.getState().objects,
      validHomePose: isValidHomePose(useDomainSceneStore.getState().homePose),
    },
    task: { operations: useSemanticEditor.getState().operations },
    compile: {
      result: useSemanticEditor.getState().result,
      dirty: useSemanticEditor.getState().dirty,
    },
    execution: { status: 'ready' as const },
    analysis: { summary: null },
  }
}

describe('semantic store dirty counter (workflow-state spec)', () => {
  it('starts at 0', () => {
    expect(useSemanticEditor.getState().dirty).toBe(0)
  })

  it('addOperation bumps dirty', () => {
    useSemanticEditor.getState().addOperation(op)
    expect(useSemanticEditor.getState().dirty).toBe(1)
  })

  it('removeOperation bumps dirty', () => {
    useSemanticEditor.getState().removeOperation(0)
    expect(useSemanticEditor.getState().dirty).toBe(1)
  })

  it('moveOperation bumps dirty', () => {
    useSemanticEditor.getState().moveOperation(0, 2)
    expect(useSemanticEditor.getState().dirty).toBe(1)
  })

  it('updateOperation bumps dirty', () => {
    useSemanticEditor.getState().updateOperation(0, { object: 'tray-1' })
    expect(useSemanticEditor.getState().dirty).toBe(1)
  })

  it('accumulates across repeated mutations', () => {
    useSemanticEditor.getState().addOperation(op)
    useSemanticEditor.getState().addOperation(op)
    useSemanticEditor.getState().updateOperation(0, { object: 'tray-1' })
    expect(useSemanticEditor.getState().dirty).toBe(3)
  })

  it('setResult (successful compile) resets dirty to 0', () => {
    useSemanticEditor.getState().addOperation(op)
    useSemanticEditor.getState().addOperation(op)
    expect(useSemanticEditor.getState().dirty).toBe(2)

    useSemanticEditor.getState().setResult(compileResult)
    expect(useSemanticEditor.getState().dirty).toBe(0)
  })

  it('reset() restores dirty to 0', () => {
    useSemanticEditor.getState().addOperation(op)
    expect(useSemanticEditor.getState().dirty).toBe(1)
    useSemanticEditor.getState().reset()
    expect(useSemanticEditor.getState().dirty).toBe(0)
  })
})

describe('dirty counter wired into deriveWorkflowState (spec scenarios)', () => {
  it('operation edit after a successful compile invalidates compiled', () => {
    // Compile succeeds → dirty reset → compiled true.
    useSemanticEditor.getState().setResult(compileResult)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(true)

    // The user edits a program operation → dirty bumps → compiled false.
    useSemanticEditor.getState().updateOperation(0, { object: 'tray-1' })
    const state = deriveWorkflowState(workflowSnapshot())
    expect(useSemanticEditor.getState().dirty).toBe(1)
    expect(state.compiled).toBe(false)
  })

  it('recompiling after edits resets dirty and restores compiled', () => {
    useSemanticEditor.getState().setResult(compileResult)
    useSemanticEditor.getState().addOperation(op)
    useSemanticEditor.getState().removeOperation(0)
    expect(useSemanticEditor.getState().dirty).toBe(2)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(false)

    useSemanticEditor.getState().setResult(compileResult)
    expect(useSemanticEditor.getState().dirty).toBe(0)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(true)
  })
})
