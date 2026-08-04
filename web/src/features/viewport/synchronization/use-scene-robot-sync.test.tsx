// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSceneRobotSync } from './use-scene-robot-sync'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import type { RuntimeInfo } from '../types'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}))

vi.mock('./use-scene-loader', () => ({
  useLoadRobot: () => ({ mutate: mocks.mutate }),
}))

function runtime(robotId: string): RuntimeInfo {
  return {
    robot: { id: robotId, display_name: 'test', dof: 2, joints: [] },
    joints: [],
    generatedAt: '2026-08-04T00:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useRobotStore.getState().setRobots([
    { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
    { id: 'planar_3r', display_name: 'Planar 3R', dof: 3, joints: [] },
  ])
  useRobotStore.getState().select(null)
  useSceneStore.getState().reset()
})

describe('useSceneRobotSync — identity derived from the scene runtime (spec R2.1)', () => {
  it('requests a catalog robot that the scene runtime does not confirm yet', () => {
    useSceneStore.setState({ runtime: runtime('planar_3r') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))

    expect(mocks.mutate).toHaveBeenCalledWith('scara')
  })

  it('does NOT request a robot already confirmed by the scene runtime (identity from applyScene, not selectedId)', () => {
    // The scene (applyScene response) already confirms scara — selecting it
    // again in the catalog is a no-op, not a new load request.
    useSceneStore.setState({ runtime: runtime('scara') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))

    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('requests a catalog robot when the scene holds a non-catalog (URDF) identity', () => {
    useSceneStore.setState({ runtime: runtime('urdf:a3f8b2c1d4e5') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))

    expect(mocks.mutate).toHaveBeenCalledWith('scara')
  })
})
