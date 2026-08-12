// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { TOOLS_BY_PERSPECTIVE } from './tools-registry'

describe('TOOLS_BY_PERSPECTIVE — registry shape (design: accordion all-closed default)', () => {
  it('exposes exactly the three robot tools (fk, ik, tcp) — workspace analysis moved to /analysis (P0-B)', () => {
    expect(TOOLS_BY_PERSPECTIVE.robot.map((t) => t.id)).toEqual(['fk', 'ik', 'tcp'])
  })

  it('carries no defaultOpen field — accordion panels start closed (Base UI single-open default)', () => {
    const tools = TOOLS_BY_PERSPECTIVE.robot
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect('defaultOpen' in tool).toBe(false)
    }
  })
})
