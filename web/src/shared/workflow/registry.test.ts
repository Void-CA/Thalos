import { describe, it, expect } from 'vitest'
import { WORKSPACE_REGISTRY } from './registry'

describe('WORKSPACE_REGISTRY (slice 1 — navigation contract)', () => {
  it('registers the 7 spec paths in order', () => {
    expect(WORKSPACE_REGISTRY.map((e) => e.path)).toEqual([
      '/',
      '/task',
      '/planning',
      '/analysis',
      '/execution',
      '/sessions',
      '/knowledge',
    ])
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
