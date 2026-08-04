// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { useRobotStore } from './store'
import type { RobotMetadataDto } from './api/robot-api.types'

const CATALOG: RobotMetadataDto[] = [
  { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
  { id: 'planar_3r', display_name: 'Planar 3R', dof: 3, joints: [] },
]

beforeEach(() => {
  useRobotStore.setState({ robots: CATALOG, selectedId: null })
})

describe('useRobotStore.select — catalog-only guard (spec R5.2, design D8)', () => {
  it('accepts a known catalog id (a REQUEST, not an authoritative write)', () => {
    useRobotStore.getState().select('scara')
    expect(useRobotStore.getState().selectedId).toBe('scara')
  })

  it('accepts null (deselect)', () => {
    useRobotStore.setState({ selectedId: 'scara' })
    useRobotStore.getState().select(null)
    expect(useRobotStore.getState().selectedId).toBeNull()
  })

  it('rejects unknown ids — URDF identities (urdf:*) NEVER enter the catalog selection', () => {
    useRobotStore.getState().select('urdf:a3f8b2c1d4e5')
    expect(useRobotStore.getState().selectedId).toBeNull()
  })

  it('rejects arbitrary unknown ids like a stale localStorage hint', () => {
    useRobotStore.getState().select('unknown-robot')
    expect(useRobotStore.getState().selectedId).toBeNull()
  })
})
