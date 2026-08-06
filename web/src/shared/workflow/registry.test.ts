import { describe, it, expect } from 'vitest'
import { WORKSPACE_REGISTRY, producerOf } from './registry'
import type { ArtifactKind, Capability, WorkflowFlag } from './types'

describe('WORKSPACE_REGISTRY (slice 1 — navigation contract)', () => {
  it('registers the 9 sitemap paths in order (/planning absorbed into /task, /evaluation added)', () => {
    expect(WORKSPACE_REGISTRY.map((e) => e.path)).toEqual([
      '/',
      '/scene',
      '/task',
      '/evaluation',
      '/execution',
      '/sessions',
      '/knowledge',
      '/configuration',
      '/analysis',
    ])
  })

  it('registers /analysis (PR-D re-introduces the sampling tool as a kind:tool entry)', () => {
    expect(WORKSPACE_REGISTRY.some((e) => e.path === '/analysis')).toBe(true)
  })

  it('keeps paths and workspace names unique', () => {
    const paths = WORKSPACE_REGISTRY.map((e) => e.path)
    const names = WORKSPACE_REGISTRY.map((e) => e.workspace)
    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('marks exactly knowledge as hidden (sessions is visible since S5; config is a visible non-stage)', () => {
    const hidden = WORKSPACE_REGISTRY.filter((e) => e.hidden)
      .map((e) => e.workspace)
      .sort()
    expect(hidden).toEqual(['knowledge'])
  })

  it('gives every entry a non-empty label', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})

describe('WORKSPACE_REGISTRY (slice 3 — requires/produces/capability)', () => {
  it('declares requires, produces, capability and hidden on every entry', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      expect(Array.isArray(entry.requires)).toBe(true)
      expect(entry.produces === null || typeof entry.produces === 'string').toBe(true)
      expect(entry.capability === null || typeof entry.capability === 'string').toBe(true)
      expect(typeof entry.hidden).toBe('boolean')
    }
  })

  it('keeps every requires/produces flag within the WorkflowState flag set', () => {
    const valid = new Set<WorkflowFlag>([
      'robotLoaded',
      'sceneValid',
      'programValid',
      'compiled',
      'planReady',
      'analyzed',
      'executable',
      'running',
      'completed',
    ])
    for (const entry of WORKSPACE_REGISTRY) {
      for (const flag of entry.requires) {
        expect(valid.has(flag)).toBe(true)
      }
      if (entry.produces !== null) {
        expect(valid.has(entry.produces)).toBe(true)
      }
    }
  })

  it('matches the design requires/produces mapping (workflow-guards spec)', () => {
    const byWorkspace = Object.fromEntries(
      WORKSPACE_REGISTRY.map((e) => [e.workspace, e]),
    )
    expect(byWorkspace.robot.requires).toEqual([])
    expect(byWorkspace.scene.requires).toEqual(['robotLoaded'])
    // Unified programming workspace: /task is the ONLY programming area —
    // gates on sceneValid (the Motion Program is built from /scene/preview,
    // NOT from the Task-compiled plan — same D2 rule that /planning carried).
    expect(byWorkspace.task.requires).toEqual(['sceneValid'])
    // Evaluation (hotfix evaluation-workspace): evaluates an EXISTING plan —
    // Tasks compile or Motion preview — so it gates on sceneValid + planReady,
    // NOT on executable (a plan is evaluated before it is runnable).
    expect(byWorkspace.evaluation.requires).toEqual(['sceneValid', 'planReady'])
    // PR2 (workflow-guards spec): /execution gates on planReady (compiled ∨
    // sceneActivePlanPresent) so BOTH plan paths — Program handoff and Motion
    // Program preview — satisfy the guard. `analyzed` is deliberately NOT a
    // requirement: evaluation is a RECOMMENDED pre-flight checkpoint, not a
    // hard gate — the fast path (compile → execute) keeps working.
    expect(byWorkspace.execution.requires).toEqual(['sceneValid', 'planReady', 'executable'])
    // Guard relaxed (area-sessions S5): the browser browses failed/running
    // sessions too — no `completed` gate on /sessions.
    expect(byWorkspace.sessions.requires).toEqual([])
    expect(byWorkspace.knowledge.requires).toEqual(['analyzed'])
    expect(byWorkspace.configuration.requires).toEqual([])

    expect(byWorkspace.robot.produces).toBe('robotLoaded')
    expect(byWorkspace.scene.produces).toBe('sceneValid')
    expect(byWorkspace.task.produces).toBe('compiled')
    expect(byWorkspace.evaluation.produces).toBe('analyzed')
    expect(byWorkspace.execution.produces).toBe('completed')
    expect(byWorkspace.sessions.produces).toBeNull()
    expect(byWorkspace.knowledge.produces).toBeNull()
  })

  it('keeps capability-workspace exclusivity (invariant #7): one capability per workspace', () => {
    const capabilities = WORKSPACE_REGISTRY.map((e) => e.capability).filter(
      (c): c is Capability => c !== null,
    )
    // The unified programming workspace keeps `compile`; planning's `optimize`
    // dies with the /planning area — 5 → 4 capabilities.
    expect(capabilities).toHaveLength(4)
    expect(new Set(capabilities).size).toBe(capabilities.length)
    expect([...capabilities].sort()).toEqual([
      'compile',
      'execute',
      'explain',
      'replay',
    ])
  })
})

describe('WORKSPACE_REGISTRY (slice S1.7 — scene entry, Robot stage marker, labels)', () => {
  it('has a first-class Escena entry (workflow-guards "Escena entry exists")', () => {
    const scene = WORKSPACE_REGISTRY.find((e) => e.workspace === 'scene')
    expect(scene).toBeDefined()
    expect(scene!.path).toBe('/scene')
    expect(scene!.label).toBe('Escena')
    expect(scene!.requires).toEqual(['robotLoaded'])
    expect(scene!.produces).toBe('sceneValid')
    expect(scene!.hidden).toBe(false)
  })

  it('gives Robot a stage marker (workflow-guards "Robot has stage marker")', () => {
    const robot = WORKSPACE_REGISTRY.find((e) => e.workspace === 'robot')!
    expect(robot.stage).toBe(1)
    expect(robot.stepperIndex).toBe(1)
  })

  it('carries a stage marker per pipeline area in chain order (Robot=1 … Sesiones=6; tools are stage null)', () => {
    const stages = WORKSPACE_REGISTRY.map((e) => [e.workspace, e.stage] as const)
    expect(stages).toEqual([
      ['robot', 1],
      ['scene', 2],
      ['task', 3],
      ['evaluation', 4],
      ['execution', 5],
      ['sessions', 6],
      ['knowledge', null],
      ['configuration', null],
      ['analysis', null],
    ])
  })

  it('declares the typed artifact chain per area (R2, ArtifactKind)', () => {
    const byWorkspace = Object.fromEntries(
      WORKSPACE_REGISTRY.map((e) => [e.workspace, e]),
    )
    const chain: Array<[string, ArtifactKind | null, ArtifactKind | null]> = [
      ['robot', 'URDF', 'RobotModel'],
      ['scene', 'RobotModel', 'Scene'],
      // The unified programming workspace produces the FINAL plan artifact
      // (MotionPlan — handed to /execution); SemanticProgram is the
      // intermediate artifact authored inside the Programa tab.
      ['task', 'Scene', 'MotionPlan'],
      // Evaluation passes the plan through unchanged (consumes MotionPlan,
      // produces MotionPlan) — evaluating a plan does not transform it, and
      // the C3 artifact chain stays contiguous (… → MotionPlan → Runtime).
      ['evaluation', 'MotionPlan', 'MotionPlan'],
      ['execution', 'MotionPlan', 'Runtime'],
      ['sessions', 'Runtime', 'ExecutionSession'],
      ['knowledge', null, null],
      ['configuration', null, null],
    ]
    for (const [workspace, consumes, producesArtifact] of chain) {
      expect(byWorkspace[workspace].consumes).toBe(consumes)
      expect(byWorkspace[workspace].producesArtifact).toBe(producesArtifact)
    }
  })

  it('uses domain-vocabulary labels (navigation-router "TopBar nav links use area labels")', () => {
    expect(WORKSPACE_REGISTRY.map((e) => e.label)).toEqual([
      'Robot',
      'Escena',
      'Programación',
      'Evaluación',
      'Ejecución',
      'Sesiones',
      'Knowledge',
      'Configuración',
      'Analysis',
    ])
    const legacy = ['Task', 'Planning', 'Execution', 'Sessions', 'Planificación']
    expect(WORKSPACE_REGISTRY.some((e) => legacy.includes(e.label))).toBe(false)
  })
})

describe('WORKSPACE_REGISTRY (slice S3.5 — typed domain graph, user criterion C3)', () => {
  // Characterization tests: the registry data already satisfies the domain
  // graph (laid down in S1.7/S1.8) — these pin the invariant against
  // regression, proving the stepper/docs/guard/pipeline derivations all draw
  // from ONE contiguous source (design D1).
  const staged = WORKSPACE_REGISTRY.filter(
    (e): e is typeof e & { stage: number } => e.stage !== null,
  ).sort((a, b) => a.stage - b.stage)

  it('has exactly the six pipeline areas with contiguous stages 1-6', () => {
    expect(staged.map((e) => e.workspace)).toEqual([
      'robot',
      'scene',
      'task',
      'evaluation',
      'execution',
      'sessions',
    ])
    expect(staged.map((e) => e.stage)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('C3 — contiguous artifact graph: produces(area_i) === consumes(area_{i+1})', () => {
    for (let i = 0; i < staged.length - 1; i++) {
      expect(staged[i].producesArtifact, `${staged[i].workspace} → ${staged[i + 1].workspace}`).toBe(
        staged[i + 1].consumes,
      )
    }
    // Spot-check the typed chain (R2: RobotModel → Scene → MotionPlan → …).
    expect(staged[1].consumes).toBe('RobotModel')
    expect(staged[2].consumes).toBe('Scene')
    // Evaluation is a MotionPlan pass-through between Programación and Ejecución.
    expect(staged[3].consumes).toBe('MotionPlan')
    expect(staged[3].producesArtifact).toBe('MotionPlan')
    expect(staged[4].consumes).toBe('MotionPlan')
    expect(staged[5].producesArtifact).toBe('ExecutionSession')
  })

  it('C2 observation — stepperIndex equals stage on every pipeline area (redundant, flagged for verify)', () => {
    for (const entry of staged) {
      expect(entry.stepperIndex).toBe(entry.stage)
    }
  })

  it('keeps every pipeline stage guards typed (requires list + produces flag, per area)', () => {
    const expected: Array<[string, WorkflowFlag[], WorkflowFlag | null]> = [
      ['robot', [], 'robotLoaded'],
      ['scene', ['robotLoaded'], 'sceneValid'],
      ['task', ['sceneValid'], 'compiled'],
      ['evaluation', ['sceneValid', 'planReady'], 'analyzed'],
      // PR2: planReady replaces the raw `compiled` prerequisite — the Motion
      // Program preview path (activePlanPresent) also unlocks /execution.
      ['execution', ['sceneValid', 'planReady', 'executable'], 'completed'],
      ['sessions', [], null],
    ]
    for (const [workspace, requires, produces] of expected) {
      const entry = WORKSPACE_REGISTRY.find((e) => e.workspace === workspace)!
      expect(entry.requires).toEqual(requires)
      expect(entry.produces).toBe(produces)
    }
  })

  it('non-stage areas (stage null) are not part of the pipeline chain', () => {
    const nonStage = WORKSPACE_REGISTRY.filter((e) => e.stage === null).map((e) => e.workspace)
    expect(nonStage).toEqual(['knowledge', 'configuration', 'analysis'])
  })
})

describe('producerOf (registry helper)', () => {
  it('maps each produced flag to the workspace that produces it', () => {
    expect(producerOf('robotLoaded')?.path).toBe('/')
    expect(producerOf('sceneValid')?.path).toBe('/scene')
    expect(producerOf('compiled')?.path).toBe('/task')
    expect(producerOf('completed')?.path).toBe('/execution')
  })

  it('returns undefined for flags no workspace produces', () => {
    expect(producerOf('programValid')).toBeUndefined()
    expect(producerOf('executable')).toBeUndefined()
    expect(producerOf('running')).toBeUndefined()
  })

  it('maps analyzed to the /evaluation workspace (the restored producer)', () => {
    // The `analyzed` flag regained its producer when the evaluation view was
    // added — Knowledge's guard (requires analyzed) now redirects there.
    expect(producerOf('analyzed')?.path).toBe('/evaluation')
    expect(producerOf('analyzed')).toBe(
      WORKSPACE_REGISTRY.find((e) => e.workspace === 'evaluation'),
    )
  })

  it('resolves derived planReady to the producer of its origin (compiled → /task)', () => {
    // PR2 (workflow-guards spec "No plan at all redirects to Task"): planReady
    // is DERIVED (compiled ∨ activePlanPresent) — no workspace produces it
    // directly, but the guard must keep redirecting to /task (the producer of
    // compiled) when NO plan exists at all. producerOf resolves the origin so
    // GuardedRoute stays declarative.
    expect(producerOf('planReady')?.path).toBe('/task')
    expect(producerOf('planReady')).toBe(producerOf('compiled'))
  })

  it('stays consistent with the registry (every produces is found)', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      if (entry.produces !== null) {
        expect(producerOf(entry.produces)).toBe(entry)
      }
    }
  })
})

describe('WORKSPACE_REGISTRY (PR-D — kind nav model, auxiliary-tools-navigation spec)', () => {
  it('defaults kind to stage on the six pipeline entries (no explicit kind — backward compatible)', () => {
    const pipeline = WORKSPACE_REGISTRY.filter((e) => e.stage !== null)
    expect(pipeline).toHaveLength(6)
    for (const entry of pipeline) {
      expect(entry.kind).toBeUndefined()
    }
  })

  it('registers /analysis as a tool entry (kind tool, requires robotLoaded, stage null)', () => {
    const analysis = WORKSPACE_REGISTRY.find((e) => e.path === '/analysis')
    expect(analysis).toBeDefined()
    expect(analysis!.workspace).toBe('analysis')
    expect(analysis!.label).toBe('Analysis')
    expect(analysis!.kind).toBe('tool')
    expect(analysis!.requires).toEqual(['robotLoaded'])
    expect(analysis!.stage).toBeNull()
    expect(analysis!.produces).toBeNull()
    expect(analysis!.capability).toBeNull()
    expect(analysis!.hidden).toBe(false)
  })

  it('keeps exactly one tool entry — analysis is the first (and only) auxiliary tool', () => {
    const tools = WORKSPACE_REGISTRY.filter((e) => e.kind === 'tool')
    expect(tools.map((e) => e.path)).toEqual(['/analysis'])
  })
})

describe('WORKSPACE_REGISTRY (unified programming workspace — /planning absorbed)', () => {
  const task = WORKSPACE_REGISTRY.find((e) => e.workspace === 'task')!

  it('removes the /planning entry entirely (no redirect — the clean option)', () => {
    expect(WORKSPACE_REGISTRY.some((e) => e.path === '/planning')).toBe(false)
  })

  it('task stays stage 3 with a single programming step (Robot → Escena → Programación → Ejecución → Sesiones)', () => {
    expect(task.stage).toBe(3)
    expect(task.stepperIndex).toBe(3)
    expect(task.label).toBe('Programación')
  })

  it('task still produces `compiled` — the origin planReady redirects to /task', () => {
    expect(task.produces).toBe('compiled')
    expect(producerOf('planReady')?.path).toBe('/task')
  })

  it('models the dual artifact as producesArtifact MotionPlan (SemanticProgram is the intermediate step)', () => {
    expect(task.consumes).toBe('Scene')
    expect(task.producesArtifact).toBe('MotionPlan')
  })

  it('keeps the compile capability (planning\'s optimize is dropped with the area)', () => {
    expect(task.capability).toBe('compile')
    expect(WORKSPACE_REGISTRY.some((e) => e.capability === 'optimize')).toBe(false)
  })
})

describe('WORKSPACE_REGISTRY (evaluation workspace — pre-execution VISTA, hotfix)', () => {
  const evaluation = WORKSPACE_REGISTRY.find((e) => e.workspace === 'evaluation')!

  it('is a first-class pipeline stage between Programación and Ejecución', () => {
    expect(evaluation).toBeDefined()
    expect(evaluation.path).toBe('/evaluation')
    expect(evaluation.label).toBe('Evaluación')
    expect(evaluation.stage).toBe(4)
    expect(evaluation.stepperIndex).toBe(4)
    expect(evaluation.hidden).toBe(false)
  })

  it('execution and sessions are renumbered after the new stage (5 and 6)', () => {
    const execution = WORKSPACE_REGISTRY.find((e) => e.workspace === 'execution')!
    const sessions = WORKSPACE_REGISTRY.find((e) => e.workspace === 'sessions')!
    expect(execution.stage).toBe(5)
    expect(execution.stepperIndex).toBe(5)
    expect(sessions.stage).toBe(6)
    expect(sessions.stepperIndex).toBe(6)
  })

  it('restores the analyzed producer — the flag chain is contiguous again', () => {
    expect(evaluation.produces).toBe('analyzed')
    expect(producerOf('analyzed')?.path).toBe('/evaluation')
  })

  it('gates on sceneValid + planReady (evaluates an existing plan), not executable', () => {
    expect(evaluation.requires).toEqual(['sceneValid', 'planReady'])
  })

  it('does NOT make analyzed a hard gate on /execution (recommended checkpoint, not a block)', () => {
    const execution = WORKSPACE_REGISTRY.find((e) => e.workspace === 'execution')!
    expect(execution.requires).not.toContain('analyzed')
  })

  it('is a MotionPlan pass-through for the C3 artifact chain', () => {
    expect(evaluation.consumes).toBe('MotionPlan')
    expect(evaluation.producesArtifact).toBe('MotionPlan')
  })

  it('claims no exclusive capability (optimize stays unclaimed — dead capability)', () => {
    expect(evaluation.capability).toBeNull()
  })

  it('renders full-width in the shell (layout full — no viewport competing)', () => {
    expect(evaluation.layout).toBe('full')
  })
})
