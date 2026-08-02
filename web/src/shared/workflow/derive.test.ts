import { describe, it, expect } from 'vitest'
import { deriveWorkflowState, hasMissingFields } from './derive'
import type { WorkflowSnapshot, WorkflowState } from './types'
import type { SemanticOp, CompileResponse } from '@/features/semantic/types'
import type { PlanAnalysisResponse } from '@/features/analysis/api/plan-analysis.types'

const summary: PlanAnalysisResponse['summary'] = {
  status: 'ok',
  score: 92,
  grade: 'Good',
  message: 'Plan is healthy',
}

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const validOps: SemanticOp[] = [
  { type: 'pick', origin: 'op_1', object: 'bolt-1' },
  { type: 'place', origin: 'op_2', object: 'bolt-1', destination: 'tray-1' },
  { type: 'home', origin: 'op_3' },
]

/** All-good snapshot: every flag derives true (workflow-state spec, "Flags
 *  reflect store state" scenario). Individual tests override one domain. */
const base: WorkflowSnapshot = {
  scene: {
    robotLoaded: true,
    objects: [{ id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } }],
  },
  task: { operations: validOps },
  compile: { result: compileResult, dirty: 0 },
  execution: { status: 'ready' },
  analysis: { summary },
}

const ALL_TRUE: WorkflowState = {
  robotLoaded: true,
  taskValid: true,
  compiled: true,
  analyzed: true,
  executable: true,
  running: false,
  completed: false,
}

describe('deriveWorkflowState — derivation table (workflow-state spec)', () => {
  it('derives every flag true from an all-good snapshot', () => {
    expect(deriveWorkflowState(base)).toEqual(ALL_TRUE)
  })

  it('robotLoaded is exactly scene.robotLoaded', () => {
    expect(deriveWorkflowState({ ...base, scene: { ...base.scene, robotLoaded: false } }).robotLoaded).toBe(false)
    expect(deriveWorkflowState(base).robotLoaded).toBe(true)
  })

  it('taskValid requires >= 1 operation', () => {
    expect(deriveWorkflowState({ ...base, task: { operations: [] } }).taskValid).toBe(false)
  })

  it('taskValid requires >= 1 scene object', () => {
    expect(deriveWorkflowState({ ...base, scene: { ...base.scene, objects: [] } }).taskValid).toBe(false)
  })

  it('taskValid is false when any operation has missing fields', () => {
    const withMissing: WorkflowSnapshot = {
      ...base,
      task: { operations: [{ type: 'pick', origin: 'op_1', object: '' }] },
    }
    expect(deriveWorkflowState(withMissing).taskValid).toBe(false)
  })

  it('compiled requires a compile result', () => {
    expect(deriveWorkflowState({ ...base, compile: { result: null, dirty: 0 } }).compiled).toBe(false)
  })

  it('analyzed is exactly analysis.summary !== null', () => {
    expect(deriveWorkflowState({ ...base, analysis: { summary: null } }).analyzed).toBe(false)
    expect(deriveWorkflowState(base).analyzed).toBe(true)
  })

  it.each(['ready', 'running', 'paused'] as const)(
    'executable is true when compiled and execStatus = %s',
    (status) => {
      expect(deriveWorkflowState({ ...base, execution: { status } }).executable).toBe(true)
    },
  )

  it.each(['idle', 'loading', 'cancelled', 'failed', 'completed'] as const)(
    'executable is false when compiled but execStatus = %s',
    (status) => {
      expect(deriveWorkflowState({ ...base, execution: { status } }).executable).toBe(false)
    },
  )

  it('executable is false when not compiled, even at execStatus = ready', () => {
    const snap = {
      ...base,
      compile: { result: null, dirty: 0 },
      execution: { status: 'ready' as const },
    }
    expect(deriveWorkflowState(snap).compiled).toBe(false)
    expect(deriveWorkflowState(snap).executable).toBe(false)
  })

  it.each(['running', 'paused'] as const)(
    'running is true only while execStatus = %s',
    (status) => {
      expect(deriveWorkflowState({ ...base, execution: { status } }).running).toBe(true)
    },
  )

  it('running is false at execStatus = ready', () => {
    expect(deriveWorkflowState({ ...base, execution: { status: 'ready' } }).running).toBe(false)
  })

  it('completed is true only at execStatus = completed', () => {
    expect(deriveWorkflowState({ ...base, execution: { status: 'completed' } }).completed).toBe(true)
    expect(deriveWorkflowState(base).completed).toBe(false)
  })
})

describe('deriveWorkflowState — dirty invalidates compiled (workflow-state spec)', () => {
  it('compiled is false when a compile result exists but dirty > 0', () => {
    const snap = { ...base, compile: { result: compileResult, dirty: 2 } }
    const state = deriveWorkflowState(snap)
    expect(state.compiled).toBe(false)
    // And the invalidation cascades: a stale program cannot be executed.
    expect(state.executable).toBe(false)
  })

  it('compiled is true again once dirty resets to 0', () => {
    expect(deriveWorkflowState(base).compiled).toBe(true)
  })

  it('compiled stays false with dirty > 0 and no result', () => {
    const snap = { ...base, compile: { result: null, dirty: 3 } }
    expect(deriveWorkflowState(snap).compiled).toBe(false)
  })
})

describe('hasMissingFields — operation validation lifted from the task editor', () => {
  it('flags a pick without an object', () => {
    expect(hasMissingFields([{ type: 'pick', origin: 'op_1', object: '' }])).toBe(true)
  })

  it('flags a place without an object or destination', () => {
    expect(hasMissingFields([{ type: 'place', origin: 'op_1', object: 'bolt-1' }])).toBe(true)
    expect(hasMissingFields([{ type: 'place', origin: 'op_1', destination: 'tray-1' }])).toBe(true)
  })

  it('flags a move_to without a destination', () => {
    expect(hasMissingFields([{ type: 'move_to', origin: 'op_1' }])).toBe(true)
  })

  it('flags a wait with a zero duration', () => {
    expect(hasMissingFields([{ type: 'wait', origin: 'op_1', duration: { secs: 0, nanos: 0 } }])).toBe(true)
  })

  it('passes fully-specified operations', () => {
    expect(hasMissingFields(validOps)).toBe(false)
  })

  it('passes an empty program (no missing fields to flag)', () => {
    expect(hasMissingFields([])).toBe(false)
  })
})
