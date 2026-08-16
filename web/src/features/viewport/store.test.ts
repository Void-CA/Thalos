import { describe, it, expect, beforeEach } from 'vitest'
import { useSceneStore } from './store'
import { useWorkspaceStore, type CloudPoint } from '@/features/workspace-analysis/workspace-analysis-store'
import type { RuntimeInfo, SceneData, ExecutionInfo, ObjectTransform } from './types'
import { pushSnapshot, findInterpolationWindow, computeAlpha, interpolateTransforms } from './renderer/snapshot-interpolation'
import { INTERPOLATION_DELAY_MS } from './renderer/snapshot-interpolation'
import type { SnapshotBuffer } from './renderer/snapshot-interpolation'

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

describe('applyRuntimeDelta — execution snapshot stamping (PR1 interpolation)', () => {
  function transforms(): ObjectTransform[] {
    return [{ id: 'frame-1', translation: [1, 2, 3], rotation: [1, 0, 0, 0], scale: [1, 1, 1] }]
  }

  function execution(): ExecutionInfo {
    return { status: 'running', progress: 0.5, elapsedSecs: 1.25, source: 'Simulation' }
  }

  it('sets an execution snapshot with a numeric receivedAt stamped on arrival (PR1.11)', () => {
    useSceneStore.getState().applyScene(scene, runtime('scara'), null, null, null, null)
    useSceneStore.getState().applyRuntimeDelta([0.1, -0.2], transforms(), execution())

    const s = useSceneStore.getState()
    expect(s.transformSnapshot.kind).toBe('execution')
    if (s.transformSnapshot.kind === 'execution') {
      expect(typeof s.transformSnapshot.receivedAt).toBe('number')
      expect(Number.isFinite(s.transformSnapshot.receivedAt)).toBe(true)
      expect(s.transformSnapshot.transforms).toEqual(transforms())
    }
    expect(s.runtime?.joints).toEqual([0.1, -0.2])
    expect(s.execution).toEqual(execution())
  })

  it('keeps runtime.joints and execution intact through the interpolation path (frontier test, PR1.12)', () => {
    const joints = [0.3, 0.4]
    const exec = execution()
    useSceneStore.getState().applyScene(scene, runtime('scara'), null, null, null, null)
    useSceneStore.getState().applyRuntimeDelta(joints, transforms(), exec)

    // Drive the full renderer interpolation path with the store's snapshot.
    const { transformSnapshot, runtime: storedRuntime, execution: storedExecution } = useSceneStore.getState()
    if (transformSnapshot.kind === 'execution') {
      let buffer: SnapshotBuffer = []
      buffer = pushSnapshot(buffer, {
        transforms: transformSnapshot.transforms,
        receivedAt: transformSnapshot.receivedAt,
      })
      const renderTime = performance.now() - INTERPOLATION_DELAY_MS
      const window = findInterpolationWindow(buffer, renderTime)
      if (window) {
        const alpha = computeAlpha(renderTime, window.prev.receivedAt, window.current.receivedAt)
        interpolateTransforms(window.prev, window.current, alpha)
      }
    }

    // The interpolators never receive joints/execution — the store keeps the
    // control data separate from the visual snapshot.
    const after = useSceneStore.getState()
    expect(after.runtime?.joints).toEqual(joints)
    expect(after.execution).toBe(exec)
    expect(storedRuntime?.joints).toEqual(joints)
    expect(storedExecution).toBe(exec)
  })
})
