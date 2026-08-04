import { describe, it, expect } from 'vitest'
import { WORKSPACE_REGISTRY, producerOf } from './registry'
import type { ArtifactKind, Capability, WorkflowFlag } from './types'

describe('WORKSPACE_REGISTRY (slice 1 — navigation contract)', () => {
  it('registers the 7 sitemap paths in order (Escena added between / and /task)', () => {
    expect(WORKSPACE_REGISTRY.map((e) => e.path)).toEqual([
      '/',
      '/scene',
      '/task',
      '/planning',
      '/execution',
      '/sessions',
      '/knowledge',
    ])
  })

  it('no longer registers the absorbed /analysis workspace', () => {
    expect(WORKSPACE_REGISTRY.some((e) => e.path === '/analysis')).toBe(false)
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
    expect(byWorkspace.task.requires).toEqual(['sceneValid'])
    expect(byWorkspace.planning.requires).toEqual(['compiled'])
    expect(byWorkspace.execution.requires).toEqual(['executable'])
    expect(byWorkspace.sessions.requires).toEqual(['completed'])
    expect(byWorkspace.knowledge.requires).toEqual(['analyzed'])

    expect(byWorkspace.robot.produces).toBe('robotLoaded')
    expect(byWorkspace.scene.produces).toBe('sceneValid')
    expect(byWorkspace.task.produces).toBe('compiled')
    expect(byWorkspace.planning.produces).toBe('analyzed')
    expect(byWorkspace.execution.produces).toBe('completed')
    expect(byWorkspace.sessions.produces).toBeNull()
    expect(byWorkspace.knowledge.produces).toBeNull()
  })

  it('keeps capability-workspace exclusivity (invariant #7): one capability per workspace', () => {
    const capabilities = WORKSPACE_REGISTRY.map((e) => e.capability).filter(
      (c): c is Capability => c !== null,
    )
    expect(capabilities).toHaveLength(5)
    expect(new Set(capabilities).size).toBe(capabilities.length)
    expect([...capabilities].sort()).toEqual([
      'compile',
      'execute',
      'explain',
      'optimize',
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

  it('carries a stage marker per pipeline area in chain order (Robot=1 … Sesiones=6)', () => {
    const stages = WORKSPACE_REGISTRY.map((e) => [e.workspace, e.stage] as const)
    expect(stages).toEqual([
      ['robot', 1],
      ['scene', 2],
      ['task', 3],
      ['planning', 4],
      ['execution', 5],
      ['sessions', 6],
      ['knowledge', null],
    ])
  })

  it('declares the typed artifact chain per area (R2, ArtifactKind)', () => {
    const byWorkspace = Object.fromEntries(
      WORKSPACE_REGISTRY.map((e) => [e.workspace, e]),
    )
    const chain: Array<[string, ArtifactKind | null, ArtifactKind | null]> = [
      ['robot', 'URDF', 'RobotModel'],
      ['scene', 'RobotModel', 'Scene'],
      ['task', 'Scene', 'SemanticProgram'],
      ['planning', 'SemanticProgram', 'MotionPlan'],
      ['execution', 'MotionPlan', 'Runtime'],
      ['sessions', 'Runtime', 'ExecutionSession'],
      ['knowledge', null, null],
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
      'Planificación',
      'Ejecución',
      'Sesiones',
      'Knowledge',
    ])
    const legacy = ['Task', 'Planning', 'Execution', 'Sessions']
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
      'planning',
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
    // Spot-check the typed chain (R2: RobotModel → Scene → SemanticProgram → …).
    expect(staged[1].consumes).toBe('RobotModel')
    expect(staged[2].consumes).toBe('Scene')
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
      ['planning', ['compiled'], 'analyzed'],
      ['execution', ['executable'], 'completed'],
      ['sessions', ['completed'], null],
    ]
    for (const [workspace, requires, produces] of expected) {
      const entry = WORKSPACE_REGISTRY.find((e) => e.workspace === workspace)!
      expect(entry.requires).toEqual(requires)
      expect(entry.produces).toBe(produces)
    }
  })

  it('non-stage areas (stage null) are not part of the pipeline chain', () => {
    const nonStage = WORKSPACE_REGISTRY.filter((e) => e.stage === null).map((e) => e.workspace)
    expect(nonStage).toEqual(['knowledge'])
  })
})

describe('producerOf (registry helper)', () => {
  it('maps each produced flag to the workspace that produces it', () => {
    expect(producerOf('robotLoaded')?.path).toBe('/')
    expect(producerOf('sceneValid')?.path).toBe('/scene')
    expect(producerOf('compiled')?.path).toBe('/task')
    expect(producerOf('analyzed')?.path).toBe('/planning')
    expect(producerOf('completed')?.path).toBe('/execution')
  })

  it('returns undefined for flags no workspace produces', () => {
    expect(producerOf('programValid')).toBeUndefined()
    expect(producerOf('executable')).toBeUndefined()
    expect(producerOf('running')).toBeUndefined()
  })

  it('stays consistent with the registry (every produces is found)', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      if (entry.produces !== null) {
        expect(producerOf(entry.produces)).toBe(entry)
      }
    }
  })
})
