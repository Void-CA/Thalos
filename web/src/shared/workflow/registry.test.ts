import { describe, it, expect } from 'vitest'
import { WORKSPACE_REGISTRY, producerOf } from './registry'
import type { Capability, WorkflowFlag } from './types'

describe('WORKSPACE_REGISTRY (slice 1 — navigation contract)', () => {
  it('registers the 6 final sitemap paths in order (analysis absorbed into planning)', () => {
    expect(WORKSPACE_REGISTRY.map((e) => e.path)).toEqual([
      '/',
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

  it('marks exactly sessions and knowledge as hidden (nav links suppressed)', () => {
    const hidden = WORKSPACE_REGISTRY.filter((e) => e.hidden)
      .map((e) => e.workspace)
      .sort()
    expect(hidden).toEqual(['knowledge', 'sessions'])
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
      'taskValid',
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

  it('matches the design requires/produces mapping (design.md:118-125)', () => {
    const byWorkspace = Object.fromEntries(
      WORKSPACE_REGISTRY.map((e) => [e.workspace, e]),
    )
    expect(byWorkspace.robot.requires).toEqual([])
    expect(byWorkspace.task.requires).toEqual(['robotLoaded'])
    expect(byWorkspace.planning.requires).toEqual(['compiled'])
    expect(byWorkspace.execution.requires).toEqual(['executable'])
    expect(byWorkspace.sessions.requires).toEqual(['completed'])
    expect(byWorkspace.knowledge.requires).toEqual(['analyzed'])

    expect(byWorkspace.task.produces).toBe('compiled')
    expect(byWorkspace.planning.produces).toBe('analyzed')
    expect(byWorkspace.execution.produces).toBe('completed')
    expect(byWorkspace.robot.produces).toBeNull()
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

describe('producerOf (registry helper)', () => {
  it('maps each produced flag to the workspace that produces it', () => {
    expect(producerOf('compiled')?.path).toBe('/task')
    expect(producerOf('analyzed')?.path).toBe('/planning')
    expect(producerOf('completed')?.path).toBe('/execution')
  })

  it('returns undefined for flags no workspace produces', () => {
    expect(producerOf('robotLoaded')).toBeUndefined()
    expect(producerOf('taskValid')).toBeUndefined()
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
