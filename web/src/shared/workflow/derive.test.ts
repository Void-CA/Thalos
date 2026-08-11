import { describe, it, expect } from 'vitest'
import {
  deriveWorkflowState,
  deriveStepperStages,
  deriveStatusMessage,
  hasMissingFields,
  isValidHomePose,
  requirementReason,
  stepperStages,
} from './derive'
import { WORKSPACE_REGISTRY } from './registry'
import type { WorkflowSnapshot, WorkflowState } from './types'
import type { SemanticOp, PoseDef } from '@/shared/contracts'
import type { CompileResponse } from '@/features/semantic/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

const analysisReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.92,
    score: 92,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
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
 *  reflect store state" scenario). Individual tests override one domain.
 *  `activePlanPresent` defaults to false — the all-good snapshot uses the
 *  compiled path; the planning-preview path is exercised by dedicated tests. */
const base: WorkflowSnapshot = {
  scene: {
    robotLoaded: true,
    objects: [{ id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } }],
    validHomePose: true,
    activePlanPresent: false,
  },
  task: { operations: validOps },
  compile: { result: compileResult, dirty: 0 },
  execution: { status: 'ready' },
  analysis: { report: analysisReport },
}

const ALL_TRUE: WorkflowState = {
  robotLoaded: true,
  sceneValid: true,
  programValid: true,
  compiled: true,
  planReady: true,
  analyzed: true,
  executable: true,
  executionViewable: true,
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

  it('sceneValid requires >= 1 scene object', () => {
    const state = deriveWorkflowState({ ...base, scene: { ...base.scene, objects: [] } })
    expect(state.sceneValid).toBe(false)
  })

  it('sceneValid requires a valid home pose', () => {
    const state = deriveWorkflowState({ ...base, scene: { ...base.scene, validHomePose: false } })
    expect(state.sceneValid).toBe(false)
  })

  it('sceneValid requires a loaded robot (artifact chain R2)', () => {
    const state = deriveWorkflowState({ ...base, scene: { ...base.scene, robotLoaded: false } })
    expect(state.sceneValid).toBe(false)
  })

  it('programValid requires >= 1 operation', () => {
    const state = deriveWorkflowState({ ...base, task: { operations: [] } })
    expect(state.programValid).toBe(false)
    // An incomplete program does NOT invalidate the scene (the split).
    expect(state.sceneValid).toBe(true)
  })

  it('programValid is false when any operation has missing fields', () => {
    const withMissing: WorkflowSnapshot = {
      ...base,
      task: { operations: [{ type: 'pick', origin: 'op_1', object: '' }] },
    }
    expect(deriveWorkflowState(withMissing).programValid).toBe(false)
  })

  it('programValid requires a valid scene (artifact chain R2)', () => {
    const state = deriveWorkflowState({ ...base, scene: { ...base.scene, objects: [] } })
    expect(state.programValid).toBe(false)
  })

  it('scene validity and program validity are separately meaningful', () => {
    // Scene valid + empty program → sceneValid true, programValid false
    // (the split that taskValid used to conflate — workflow-state spec).
    const state = deriveWorkflowState({ ...base, task: { operations: [] } })
    expect(state.sceneValid).toBe(true)
    expect(state.programValid).toBe(false)
  })

  it('compiled requires a compile result', () => {
    expect(deriveWorkflowState({ ...base, compile: { result: null, dirty: 0 } }).compiled).toBe(false)
  })

  it('compiled requires a valid program (artifact chain R2)', () => {
    expect(deriveWorkflowState({ ...base, task: { operations: [] } }).compiled).toBe(false)
  })

  it('analyzed is exactly analysis.report !== null', () => {
    expect(deriveWorkflowState({ ...base, analysis: { report: null } }).analyzed).toBe(false)
    expect(deriveWorkflowState(base).analyzed).toBe(true)
  })

  it.each(['ready', 'running', 'paused'] as const)(
    'executable is true when compiled and execStatus = %s',
    (status) => {
      expect(deriveWorkflowState({ ...base, execution: { status } }).executable).toBe(true)
    },
  )

  it.each(['idle', 'loading', 'cancelled', 'failed', 'completed'] as const)(
    'executable is false when planReady but execStatus = %s',
    (status) => {
      expect(deriveWorkflowState({ ...base, execution: { status } }).executable).toBe(false)
    },
  )

  it('executable is false when not planReady (no compiled, no active plan), even at execStatus = ready', () => {
    const snap = {
      ...base,
      compile: { result: null, dirty: 0 },
      scene: { ...base.scene, activePlanPresent: false },
      execution: { status: 'ready' as const },
    }
    expect(deriveWorkflowState(snap).compiled).toBe(false)
    expect(deriveWorkflowState(snap).planReady).toBe(false)
    expect(deriveWorkflowState(snap).executable).toBe(false)
  })

  // ── planReady (workflow-state spec: compiled ∨ sceneActivePlanPresent) ────
  // The flag covers BOTH plan sources: the Task compile handoff and the
  // Planning preview path. executable is rebased on planReady, so a previewed
  // plan is runnable even though `compiled` stays false.

  it('planReady is true from the compiled path (compiled && !dirty)', () => {
    expect(deriveWorkflowState(base).planReady).toBe(true)
  })

  it('planReady is true from the planning preview path (activePlanPresent) even without compiled', () => {
    const snap = {
      ...base,
      compile: { result: null, dirty: 0 },
      scene: { ...base.scene, activePlanPresent: true },
      execution: { status: 'ready' as const },
    }
    const state = deriveWorkflowState(snap)
    expect(state.compiled).toBe(false)
    expect(state.planReady).toBe(true)
    // The previewed plan is runnable: executable does NOT require compiled.
    expect(state.executable).toBe(true)
  })

  it('planReady is false when no plan exists at all', () => {
    const snap = {
      ...base,
      compile: { result: null, dirty: 0 },
      scene: { ...base.scene, activePlanPresent: false },
    }
    expect(deriveWorkflowState(snap).planReady).toBe(false)
  })

  it('executable is false from a previewed plan when execStatus is not runnable', () => {
    const snap = {
      ...base,
      compile: { result: null, dirty: 0 },
      scene: { ...base.scene, activePlanPresent: true },
      execution: { status: 'idle' as const },
    }
    expect(deriveWorkflowState(snap).planReady).toBe(true)
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

// ── C1 property tests: impossible states (tasks.md S1.3, user criterion) ─────
//
// MECHANISM (decision): fast-check is NOT installed in this project, so this
// suite does deterministic EXHAUSTIVE enumeration instead of generative
// property testing: all 2^9 = 512 combinations of the nine boolean store
// facts that feed deriveWorkflowState. No dependency, fully reproducible.
//
// The 9 inputs: robotLoaded, objects>=1, validHomePose, operations>=1,
// hasMissingFields, compileResult!=null, dirty>0, execStatus∈EXECUTABLE,
// activePlanPresent (the planning-preview plan path).
//
// Invariants asserted over EVERY combination (workflow-state spec R2 +
// tasks.md C1 — the artifact chain makes impossible states impossible):
//   sceneValid ⇒ robotLoaded
//   programValid ⇒ sceneValid
//   compiled ⇒ programValid
//   executable ⇒ planReady   (REBASED in PR2: planReady = compiled ∨ activePlanPresent)

interface InputCombo {
  robotLoaded: boolean
  objects: 0 | 1
  validHomePose: boolean
  operations: 0 | 1
  hasMissingFields: boolean
  compileResult: boolean
  dirty: boolean
  execStatus: 'ready' | 'idle'
  activePlanPresent: boolean
}

/** Exhaustive 2^9 enumeration — each bit of the mask is one input. */
function allInputCombos(): InputCombo[] {
  const combos: InputCombo[] = []
  for (let mask = 0; mask < 512; mask++) {
    combos.push({
      robotLoaded: (mask & 1) !== 0,
      objects: (mask & 2) !== 0 ? 1 : 0,
      validHomePose: (mask & 4) !== 0,
      operations: (mask & 8) !== 0 ? 1 : 0,
      hasMissingFields: (mask & 16) !== 0,
      compileResult: (mask & 32) !== 0,
      dirty: (mask & 64) !== 0,
      execStatus: (mask & 128) !== 0 ? 'ready' : 'idle',
      activePlanPresent: (mask & 256) !== 0,
    })
  }
  return combos
}

function snapshotFrom(input: InputCombo): WorkflowSnapshot {
  const operations: SemanticOp[] =
    input.operations === 1
      ? input.hasMissingFields
        ? [{ type: 'pick', origin: 'op_1', object: '' }]
        : validOps
      : []
  return {
    scene: {
      robotLoaded: input.robotLoaded,
      objects:
        input.objects === 1
          ? [{ id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } }]
          : [],
      validHomePose: input.validHomePose,
      activePlanPresent: input.activePlanPresent,
    },
    task: { operations },
    compile: { result: input.compileResult ? compileResult : null, dirty: input.dirty ? 2 : 0 },
    execution: { status: input.execStatus },
    // `analyzed` is NOT part of the 2^9 enumeration (10th input, boolean-collapsed):
    // the report is always present so `analyzed` derives true uniformly.
    analysis: { report: analysisReport },
  }
}

describe('C1 property — exhaustive 2^9 impossible-state invariants (tasks.md S1.3)', () => {
  const combos = allInputCombos()

  it('enumerates exactly 2^9 = 512 distinct input combinations', () => {
    expect(combos).toHaveLength(512)
    expect(new Set(combos.map((c) => JSON.stringify(c))).size).toBe(512)
  })

  it('never yields an impossible state: every chain implication holds for all 512 combinations', () => {
    let violations = 0
    for (const input of combos) {
      const state = deriveWorkflowState(snapshotFrom(input))
      if (state.sceneValid && !state.robotLoaded) violations++
      if (state.programValid && !state.sceneValid) violations++
      if (state.compiled && !state.programValid) violations++
      if (state.executable && !state.planReady) violations++
    }
    expect(violations).toBe(0)
  })

  it('the invariants are not vacuous: every chain flag is reachable true AND false', () => {
    const derived = combos.map((input) => deriveWorkflowState(snapshotFrom(input)))
    // running/completed/analyzed are excluded: their inputs (specific
    // execStatus values, analysis.summary) are boolean-collapsed in the 2^9
    // space and are enumerated by the derivation-table it.each tests above.
    for (const flag of ['robotLoaded', 'sceneValid', 'programValid', 'compiled', 'planReady', 'executable'] as const) {
      expect(derived.some((s) => s[flag]), `${flag} is never true across the space`).toBe(true)
      expect(derived.some((s) => !s[flag]), `${flag} is never false across the space`).toBe(true)
    }
  })

  it('a scene cannot be valid without a robot, nor a program without a scene (spot check)', () => {
    const noRobotButScene = snapshotFrom({
      robotLoaded: false, objects: 1, validHomePose: true, operations: 1,
      hasMissingFields: false, compileResult: true, dirty: false, execStatus: 'ready',
      activePlanPresent: false,
    })
    const state = deriveWorkflowState(noRobotButScene)
    expect(state.sceneValid).toBe(false)
    expect(state.programValid).toBe(false)
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

describe('isValidHomePose — home-pose validity feeding sceneValid', () => {
  const validPose: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

  it('accepts a well-formed default home pose', () => {
    expect(isValidHomePose(validPose)).toBe(true)
  })

  it('rejects null/undefined poses', () => {
    expect(isValidHomePose(null)).toBe(false)
    expect(isValidHomePose(undefined)).toBe(false)
  })

  // Malformed poses are impossible at the type level (PoseDef is a fixed
  // tuple) but reachable at runtime — the cast is deliberate: it exercises
  // the defensive runtime check.
  it('rejects a pose with a truncated position or orientation', () => {
    expect(isValidHomePose({ position: [1.8, 0.0], orientation: [0, 0, 0, 1] } as unknown as PoseDef)).toBe(false)
    expect(isValidHomePose({ position: [1.8, 0.0, 0.5], orientation: [0, 0, 0] } as unknown as PoseDef)).toBe(false)
  })

  it('rejects a pose with a non-finite component', () => {
    expect(isValidHomePose({ position: [1.8, 0.0, Number.NaN], orientation: [0, 0, 0, 1] } as unknown as PoseDef)).toBe(false)
    expect(isValidHomePose({ position: [1.8, Number.POSITIVE_INFINITY, 0.5], orientation: [0, 0, 0, 1] } as unknown as PoseDef)).toBe(false)
  })
})

describe('stepperStages — six stages derived from the registry `stage` order (global-stepper spec S3)', () => {
  it('exposes the six pipeline areas in stage order: robot … sessions (no planning tab)', () => {
    expect(stepperStages(WORKSPACE_REGISTRY).map((e) => e.workspace)).toEqual([
      'robot',
      'scene',
      'task',
      'evaluation',
      'execution',
      'sessions',
    ])
  })

  it('includes Robot as stage 1 (Robot is a pipeline stage, not the root)', () => {
    const stages = stepperStages(WORKSPACE_REGISTRY)
    expect(stages[0].workspace).toBe('robot')
    expect(stages[0].stage).toBe(1)
  })

  it('orders the stages by the registry `stage` field (canonical order), not by capability', () => {
    const stages = stepperStages(WORKSPACE_REGISTRY)
    expect(stages.map((e) => e.stage)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('C2 observation: stepperIndex is redundant — equals stage on every pipeline area (flagged for verify)', () => {
    for (const entry of stepperStages(WORKSPACE_REGISTRY)) {
      expect(entry.stepperIndex).toBe(entry.stage)
    }
  })

  it('excludes areas without a stage (knowledge; Configuración is not a stepper stage)', () => {
    const stages = stepperStages(WORKSPACE_REGISTRY)
    expect(stages.every((e) => e.stage !== null)).toBe(true)
    expect(stages.some((e) => e.workspace === 'knowledge')).toBe(false)
    expect(stages.some((e) => e.workspace === 'configuration')).toBe(false)
  })

  it('excludes the absorbed analysis content (no /analysis stage after slice 6)', () => {
    expect(stepperStages(WORKSPACE_REGISTRY).some((e) => e.path === '/analysis')).toBe(false)
  })
})

describe('deriveStepperStages — per-stage state from flags + active route', () => {
  it('marks the active route stage as current', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: false },
      '/task',
      WORKSPACE_REGISTRY,
    )
    expect(stages.find((s) => s.entry.workspace === 'task')?.state).toBe('current')
    expect(stages.find((s) => s.entry.workspace === 'task')?.reason).toBeNull()
  })

  it('marks the Robot stage current on the root route (Robot is stage 1, its own area)', () => {
    const stages = deriveStepperStages(ALL_TRUE, '/', WORKSPACE_REGISTRY)
    expect(stages.find((s) => s.entry.workspace === 'robot')?.state).toBe('current')
  })

  it('derives the full spec progress scenario (Robot passed … Ejecución pending)', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: true },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const byWs = Object.fromEntries(stages.map((s) => [s.entry.workspace, s]))
    expect(byWs.robot.state).toBe('passed') // robotLoaded produced
    expect(byWs.scene.state).toBe('passed') // sceneValid produced
    expect(byWs.task.state).toBe('current') // active route
    expect(byWs.evaluation.state).toBe('passed') // analyzed produced
    expect(byWs.execution.state).toBe('pending') // requirements met, not reached
    expect(byWs.sessions.state).toBe('pending') // guard relaxed — nothing blocks the browser
    expect(byWs.sessions.reason).toBeNull()
  })

  it('blocks Execution when not viewable (no runnable or finished execution)', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executionViewable: false },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const execution = stages.find((s) => s.entry.workspace === 'execution')!
    expect(execution.state).toBe('blocked')
    expect(execution.reason).toBe('Requires a runnable or finished execution')
  })

  it('keeps Execution open when a run just finished (no kick-out on Completed)', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: false, executionViewable: true },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const execution = stages.find((s) => s.entry.workspace === 'execution')!
    expect(execution.state).not.toBe('blocked')
    expect(execution.reason).toBeNull()
  })

  it('derives the reason from the first missing flag (sceneValid → execution)', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, sceneValid: false },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const execution = stages.find((s) => s.entry.workspace === 'execution')!
    expect(execution.state).toBe('blocked')
    expect(execution.reason).toBe('Requires a valid scene')
  })

  it('never blocks sessions — the guard is relaxed (no requirement gates the browser)', () => {
    // S5.1 AUDIT verdict (area-sessions spec): `completed` was REMOVED from
    // sessions.requires so failed/running sessions are browsable. With
    // completed=false the stage is pending (unreached), never blocked.
    const stages = deriveStepperStages(ALL_TRUE, '/execution', WORKSPACE_REGISTRY)
    const sessions = stages.find((s) => s.entry.workspace === 'sessions')!
    expect(sessions.state).toBe('pending')
    expect(sessions.reason).toBeNull()
  })

  it('passes a stage whose produces flag is already true', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: false },
      '/execution',
      WORKSPACE_REGISTRY,
    )
    const task = stages.find((s) => s.entry.workspace === 'task')!
    expect(task.state).toBe('passed')
    expect(task.reason).toBeNull()
  })

  it('passes stages that come before the current one (position)', () => {
    const stages = deriveStepperStages({ ...ALL_TRUE, completed: true }, '/sessions', WORKSPACE_REGISTRY)
    for (const ws of ['task', 'execution']) {
      expect(stages.find((s) => s.entry.workspace === ws)?.state).toBe('passed')
    }
  })

  it('keeps a future stage pending when requirements are met', () => {
    const stages = deriveStepperStages(
      { ...ALL_TRUE, executable: true },
      '/task',
      WORKSPACE_REGISTRY,
    )
    const execution = stages.find((s) => s.entry.workspace === 'execution')!
    expect(execution.state).toBe('pending')
    expect(execution.reason).toBeNull()
  })
})

describe('requirementReason — derived from the registry, never per-workspace strings', () => {
  it('returns null when every requirement is met', () => {
    const task = WORKSPACE_REGISTRY.find((e) => e.workspace === 'task')!
    expect(requirementReason(task, ALL_TRUE)).toBeNull()
  })

  it('names the missing flag when requirements are unmet', () => {
    const task = WORKSPACE_REGISTRY.find((e) => e.workspace === 'task')!
    expect(requirementReason(task, { ...ALL_TRUE, sceneValid: false })).toBe(
      'Requires a valid scene',
    )
  })

  it('names sceneValid when the scene is invalid (split flags)', () => {
    const task = WORKSPACE_REGISTRY.find((e) => e.workspace === 'task')!
    expect(requirementReason(task, { ...ALL_TRUE, sceneValid: false })).toBe(
      'Requires a valid scene',
    )
  })
})

describe('deriveStatusMessage — short status from workflow flags (S2)', () => {
  it('reports no robot loaded when the robot is missing', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, robotLoaded: false })).toBe('No robot loaded')
  })

  it('reports an incomplete scene', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, sceneValid: false })).toBe('Scene incomplete')
  })

  it('reports an incomplete task', () => {
    expect(deriveStatusMessage({ ...ALL_TRUE, programValid: false })).toBe('Task incomplete')
  })

  it('reports the Motion Program as ready when the preview plan is executable without a compile', () => {
    // R3-001: {compiled:false, planReady:true, executable:true} is REACHABLE via
    // the Motion Program preview path — it must NOT read as "Task modified".
    const state = { ...ALL_TRUE, compiled: false, planReady: true, executable: true }
    expect(deriveStatusMessage(state)).not.toContain('Task modified')
    expect(deriveStatusMessage(state)).toBe('Motion Program ready — send to execution')
  })

  it('still reports recompilation required when the stale plan is not executable', () => {
    expect(
      deriveStatusMessage({ ...ALL_TRUE, compiled: false, planReady: false, executable: false }),
    ).toBe('Task modified — recompilation required')
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
