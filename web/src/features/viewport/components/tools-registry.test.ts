// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { TOOLS_BY_PERSPECTIVE } from './tools-registry'

describe('TOOLS_BY_PERSPECTIVE — registry shape (design: accordion all-closed default)', () => {
  it('exposes exactly the four robot tools (fk, ik, workspace, tcp)', () => {
    expect(TOOLS_BY_PERSPECTIVE.robot.map((t) => t.id)).toEqual(['fk', 'ik', 'workspace', 'tcp'])
  })

  it('carries no defaultOpen field — accordion panels start closed (Base UI single-open default)', () => {
    const tools = TOOLS_BY_PERSPECTIVE.robot
    expect(tools).toHaveLength(4)
    for (const tool of tools) {
      expect('defaultOpen' in tool).toBe(false)
    }
  })
})
