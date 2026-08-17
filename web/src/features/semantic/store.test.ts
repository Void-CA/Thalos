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
      activePlanPresent: false,
    },
    task: { operations: useSemanticEditor.getState().operations },
    compile: {
      result: useSemanticEditor.getState().result,
      dirty: useSemanticEditor.getState().dirty,
    },
    execution: { status: 'ready' as const },
    analysis: { report: null },
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

describe('replaceOperations — atomic full replace (program-dual-editor spec I5)', () => {
  it('replaces the ENTIRE operation set (no merge with existing ops)', () => {
    useSemanticEditor.getState().addOperation(op)
    useSemanticEditor.getState().addOperation(op)
    const fresh = [
      { type: 'pick' as const, origin: 'pick-1', object: 'bolt-1' },
      { type: 'home' as const, origin: 'home-2' },
    ]
    useSemanticEditor.getState().replaceOperations(fresh)
    expect(useSemanticEditor.getState().operations).toEqual(fresh)
    expect(useSemanticEditor.getState().operations).toHaveLength(2)
  })

  it('bumps dirty (invalidates compiled)', () => {
    useSemanticEditor.getState().replaceOperations([op])
    expect(useSemanticEditor.getState().dirty).toBe(1)
  })

  it('can replace with an empty operation list', () => {
    useSemanticEditor.getState().replaceOperations([])
    expect(useSemanticEditor.getState().operations).toEqual([])
  })

  it('does not touch result/loading/error — those are owned by setResult/setLoading/setError', () => {
    useSemanticEditor.getState().setResult(compileResult)
    useSemanticEditor.getState().setError('still there')
    useSemanticEditor.getState().replaceOperations([op])
    expect(useSemanticEditor.getState().result).toEqual(compileResult)
    expect(useSemanticEditor.getState().error).toBe('still there')
  })

  it('full replace invalidates a previously compiled program via dirty (I5 scenario)', () => {
    useSemanticEditor.getState().setResult(compileResult)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(true)

    useSemanticEditor.getState().replaceOperations([op])
    expect(useSemanticEditor.getState().dirty).toBe(1)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(false)
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

describe('remapProgramToScene — scene-load sync keeps the program executable', () => {
  it('remaps missing object/location ids to the loaded scene (single-resource fallback)', () => {
    useSemanticEditor.getState().reset() // seeded: pick bolt-1 / wait / place bolt-1 at tray-1 / home
    useSemanticEditor.getState().remapProgramToScene(
      [{ id: 'box-1', name: 'Box 1' }],
      [{ id: 'tray-1', name: 'tray-1' }],
    )
    const ops = useSemanticEditor.getState().operations
    expect(ops[0]).toMatchObject({ type: 'pick', object: 'box-1' })
    expect(ops[2]).toMatchObject({ type: 'place', object: 'box-1', destination: 'tray-1' })
    expect(ops[1]).toMatchObject({ type: 'wait' })
  })

  it('bumps dirty ONLY when a reference actually changed (no-op returns same state)', () => {
    useSemanticEditor.getState().reset()
    useSemanticEditor.getState().setResult(compileResult) // compiled, dirty 0
    // The program already matches the scene → no dirty bump, compiled survives.
    useSemanticEditor.getState().remapProgramToScene(
      [{ id: 'bolt-1', name: 'Bolt' }],
      [{ id: 'tray-1', name: 'Tray' }],
    )
    expect(useSemanticEditor.getState().dirty).toBe(0)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(true)
  })

  it('invalidates a compiled program when a reference is remapped', () => {
    useSemanticEditor.getState().reset()
    useSemanticEditor.getState().setResult(compileResult)
    useSemanticEditor.getState().remapProgramToScene(
      [{ id: 'box-1', name: 'Box 1' }],
      [{ id: 'tray-1', name: 'tray-1' }],
    )
    expect(useSemanticEditor.getState().dirty).toBe(1)
    expect(deriveWorkflowState(workflowSnapshot()).compiled).toBe(false)
  })
})

describe('loadProgramText — parse a .thalos file into the editor (task-program-artifact spec)', () => {
  it('parses valid text and replaces the ENTIRE operation set (no merge)', () => {
    useSemanticEditor.getState().addOperation(op)
    useSemanticEditor.getState().addOperation(op)
    const errors = useSemanticEditor.getState().loadProgramText(
      'pick box-1\nplace box-1 at tray-1\nhome',
    )
    expect(errors).toEqual([])
    expect(useSemanticEditor.getState().operations).toEqual([
      { type: 'pick', origin: 'pick-1', object: 'box-1', tool: undefined },
      { type: 'place', origin: 'place-2', object: 'box-1', destination: 'tray-1', tool: undefined },
      { type: 'home', origin: 'home-3' },
    ])
    expect(useSemanticEditor.getState().dirty).toBeGreaterThan(0)
  })

  it('ignores comments and blank lines (spec "Comments and blank lines")', () => {
    const errors = useSemanticEditor.getState().loadProgramText(
      '# header comment\n\npick bolt-1\nhome\n',
    )
    expect(errors).toEqual([])
    expect(useSemanticEditor.getState().operations).toEqual([
      { type: 'pick', origin: 'pick-3', object: 'bolt-1', tool: undefined },
      { type: 'home', origin: 'home-4' },
    ])
  })

  it('preserves tool= syntax through parse (spec "Tool preserved")', () => {
    useSemanticEditor.getState().loadProgramText('pick bolt-1 tool=gripper-1')
    expect(useSemanticEditor.getState().operations[0]).toEqual({
      type: 'pick',
      origin: 'pick-1',
      object: 'bolt-1',
      tool: 'gripper-1',
    })
  })

  it('parse failure returns errors and mutates NOTHING (R2 atomicity — no partial program)', () => {
    useSemanticEditor.getState().reset()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const dirtyBefore = useSemanticEditor.getState().dirty

    const errors = useSemanticEditor.getState().loadProgramText('pick bolt-1\njump 10')

    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(2)
    expect(errors[0].message).toContain("unknown command 'jump'")
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(dirtyBefore)
  })

  it('does not touch the domain scene store (demos-workspace "Load program only")', () => {
    const sceneBefore = JSON.stringify(useDomainSceneStore.getState().objects)
    useSemanticEditor.getState().loadProgramText('pick bolt-1\nhome')
    expect(JSON.stringify(useDomainSceneStore.getState().objects)).toBe(sceneBefore)
  })
})
