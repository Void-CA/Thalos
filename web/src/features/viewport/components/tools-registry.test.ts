// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { TOOLS_BY_PERSPECTIVE } from './tools-registry'

describe('TOOLS_BY_PERSPECTIVE — TCP panel default open (tcp-resolved-pose R4)', () => {
  it('expands the Active TCP panel by default in the robot perspective', () => {
    const tcp = TOOLS_BY_PERSPECTIVE.robot.find((t) => t.id === 'tcp')
    expect(tcp?.defaultOpen).toBe(true)
  })
})
