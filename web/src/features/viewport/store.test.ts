import { describe, it, expect, beforeEach } from 'vitest'
import { useSceneStore } from './store'
import { useWorkspaceStore, type CloudPoint } from '@/features/workspace-analysis/workspace-analysis-store'
import type { RuntimeInfo, SceneData } from './types'

const scene = {} as SceneData

function runtime(robotId: string): RuntimeInfo {
  return {
    robot: { id: robotId, display_name: 'test', dof: 2, joints: [] },
    joints: [],
    generatedAt: '2026-08-04T00:00:00Z',
  }
}

beforeEach(() => {
  useSceneStore.getState().reset()
  useWorkspaceStore.getState().reset()
})

describe('applyScene — workspace cascade invalidation (spec R4)', () => {
  it('clears all workspace samples when robot.id changes (R4.1)', () => {
    // Seed the scene with robot A, then run analysis to populate samples.
    useSceneStore.getState().applyScene(scene, runtime('scara'), null, null, null, null)
    useWorkspaceStore.setState({
      workspaceSamples: [{ position: [0.5, 0.5, 0.5] }],
      singularitySamples: [{ position: [0.5, 0.5, 0.5], state: 'normal' }],
      manipulabilitySamples: [{ position: [0.5, 0.5, 0.5], yoshikawa: 0.42 }],
    })

    // applyScene delivers a DIFFERENT robot (e.g. a URDF import).
    useSceneStore.getState().applyScene(scene, runtime('urdf:a3f8b2c1d4e5'), null, null, null, null)

    expect(useWorkspaceStore.getState().workspaceSamples).toBeNull()
    expect(useWorkspaceStore.getState().singularitySamples).toBeNull()
    expect(useWorkspaceStore.getState().manipulabilitySamples).toBeNull()
  })

  it('preserves all workspace samples when applyScene delivers the same robot.id (R4.2)', () => {
    useSceneStore.getState().applyScene(scene, runtime('scara'), null, null, null, null)
    const samples: {
      workspaceSamples: CloudPoint[]
      singularitySamples: CloudPoint[]
      manipulabilitySamples: CloudPoint[]
    } = {
      workspaceSamples: [{ position: [0.5, 0.5, 0.5] }],
      singularitySamples: [{ position: [0.5, 0.5, 0.5], state: 'normal' }],
      manipulabilitySamples: [{ position: [0.5, 0.5, 0.5], yoshikawa: 0.42 }],
    }
    useWorkspaceStore.setState(samples)

    // Same robot, refreshed scene state (e.g. a plan preview) → no reset.
    useSceneStore.getState().applyScene(scene, runtime('scara'), null, null, null, null)

    expect(useWorkspaceStore.getState().workspaceSamples).toEqual(samples.workspaceSamples)
    expect(useWorkspaceStore.getState().singularitySamples).toEqual(samples.singularitySamples)
    expect(useWorkspaceStore.getState().manipulabilitySamples).toEqual(samples.manipulabilitySamples)
  })
})
