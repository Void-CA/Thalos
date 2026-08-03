import { describe, it, expect } from 'vitest'
import {
  deriveWorkflowState,
  deriveStepperStages,
  deriveStatusMessage,
  hasMissingFields,
  requirementReason,
  stepperStages,
} from './derive'
import { WORKSPACE_REGISTRY } from './registry'
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

describe('stepperStages — pipeline derived from the registry (global-stepper spec)', () => {
  it('exposes Task, Planning, Execution, Sessions in registry order', () => {
    expect(stepperStages(WORKSPACE_REGISTRY).map((e) => e.workspace)).toEqual([
      'task',
      'planning',
      'execution',
      'sessions',
    ])
  })

  it('excludes the robot root (root, not a stage)', () => {
    expect(stepperStages(WORKSPACE_REGISTRY).some((e) => e.workspace === 'robot')).toBe(false)
  })

  it('excludes the absorbed analysis content (no /analysis stage after slice 6)', () => {
    expect(stepperStages(WORKSPACE_REGISTRY).some((e) => e.path === '/analysis')).toBe(false)
  })

  it('excludes the hidden knowledge workspace (support capability, not a pipeline stage)', () => {
    expect(stepperStages(WORKSPACE_REGISTRY).some((e) => e.workspace === 'knowledge')).toBe(false)
  })
})

describe('deriveStepperStages — per-stage state from flags + active route', () => {
  it('marks the active route stage as current', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: false },
      '/planning',
      WORKSPACE_REGISTRY,
    )
    expect(stages.find((s) => s.entry.workspace === 'planning')?.state).toBe('current')
    expect(stages.find((s) => s.entry.workspace === 'planning')?.reason).toBeNull()
  })

  it('has no current stage on a non-pipeline route (robot home)', () => {
    const stages = deriveStepperStages(ALL_TRUE, '/', WORKSPACE_REGISTRY)
    expect(stages.every((s) => s.state !== 'current')).toBe(true)
  })

  it('blocks Execution when executable is unmet, with a derived reason', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: false },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const execution = stages.find((s) => s.entry.workspace === 'execution')!
    expect(execution.state).toBe('blocked')
    expect(execution.reason).toBe('Requires an executable plan')
  })

  it('derives the reason from the first missing flag (compiled → planning)', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, compiled: false, executable: false },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const planning = stages.find((s) => s.entry.workspace === 'planning')!
    expect(planning.state).toBe('blocked')
    expect(planning.reason).toBe('Requires a compiled plan')
  })

  it('derives the reason from the first missing flag (completed → sessions)', () => {
    const stages = deriveStepperStages(ALL_TRUE, '/execution', WORKSPACE_REGISTRY)
    const sessions = stages.find((s) => s.entry.workspace === 'sessions')!
    expect(sessions.state).toBe('blocked')
    expect(sessions.reason).toBe('Requires a completed execution')
  })

  it('passes a stage whose produces flag is already true', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: false },
      '/planning',
      WORKSPACE_REGISTRY,
    )
    const task = stages.find((s) => s.entry.workspace === 'task')!
    expect(task.state).toBe('passed')
    expect(task.reason).toBeNull()
  })

  it('passes stages that come before the current one (position)', () => {
    const stages = deriveStepperStages({ ...ALL_TRUE, completed: true }, '/sessions', WORKSPACE_REGISTRY)
    for (const ws of ['task', 'planning', 'execution']) {
      expect(stages.find((s) => s.entry.workspace === ws)?.state).toBe('passed')
    }
  })

  it('keeps a future stage pending when requirements are met', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: true },
      '/planning',
      WORKSPACE_REGISTRY,
    )
    const execution = stages.find((s) => s.entry.workspace === 'execution')!
    expect(execution.state).toBe('pending')
    expect(execution.reason).toBeNull()
  })
})

describe('requirementReason — derived from the registry, never per-workspace strings', () => {
  it('returns null when every requirement is met', () => {
    const planning = WORKSPACE_REGISTRY.find((e) => e.workspace === 'planning')!
    expect(requirementReason(planning, ALL_TRUE)).toBeNull()
  })

  it('names the missing flag when requirements are unmet', () => {
    const planning = WORKSPACE_REGISTRY.find((e) => e.workspace === 'planning')!
    expect(requirementReason(planning, { ...ALL_TRUE, compiled: false })).toBe(
      'Requires a compiled plan',
    )
  })
})

describe('deriveStatusMessage — short status from workflow flags (S2)', () => {
  it('reports no robot loaded when the robot is missing', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, robotLoaded: false })).toBe('No robot loaded')
  })

  it('reports an incomplete task', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, taskValid: false })).toBe('Task incomplete')
  })

  it('reports recompilation required when the plan is stale', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, compiled: false })).toBe(
      'Task modified — recompilation required',
    )
  })

  it('reports a running plan', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, running: true })).toBe('Plan running')
  })

  it('reports a completed plan and points to sessions', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, executable: false, completed: true })).toBe(
      'Plan completed — review in Sessions',
    )
  })

  it('reports a plan ready to run', () => {
    expect(deriveStatusMessage(ALL_TRUE)).toBe('Plan ready to run')
  })

  it('reports an analyzed plan before it is executable', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, executable: false })).toBe('Plan analyzed')
  })

  it('defaults to the loaded + compiled baseline', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, analyzed: false, executable: false })).toBe(
      'Robot loaded · Task compiled',
    )
  })
})
