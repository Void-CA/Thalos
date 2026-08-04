// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSceneRobotSync } from './use-scene-robot-sync'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import type { RuntimeInfo } from '../types'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  loadScene: vi.fn(),
}))

vi.mock('./use-scene-loader', () => ({
  useLoadRobot: () => ({ mutate: mocks.mutate }),
  useLoadScene: () => ({ mutate: mocks.loadScene }),
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
  localStorage.clear()
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

  it('requests a DIFFERENT catalog robot when the scene confirms another one (identity confirm, not frozen)', () => {
    // The scene confirms scara, but the user then asks for planar_3r — the
    // confirmed identity must not freeze the request path (spec R2.1: scene
    // is the writer, catalog selection is a request for a NEW identity).
    useSceneStore.setState({ runtime: runtime('scara') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('planar_3r'))

    expect(mocks.mutate).toHaveBeenCalledWith('planar_3r')
  })

  it('stays a no-op on repeated selections of the same confirmed identity (lastRequested dedupe)', () => {
    // Selecting the already-confirmed robot twice must never trigger a load —
    // guards the lastRequested dedupe against spurious re-requests.
    useSceneStore.setState({ runtime: runtime('scara') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))
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

describe('useSceneRobotSync — backend-derived default (spec R7 / R6)', () => {
  it('requests GET /scene on mount when nothing was persisted (fresh session)', () => {
    // No localStorage hint → the backend default IS the identity (R7).
    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).toHaveBeenCalledTimes(1)
  })

  it('requests GET /scene when the persisted hint is an unknown id (backend default wins, R6)', () => {
    localStorage.setItem('thalos:task:robotId', 'unknown-robot')

    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).toHaveBeenCalledTimes(1)
  })

  it('skips GET /scene when a catalog hint is persisted — the select() request path owns it', () => {
    // A valid persisted catalog id is requested later via select() →
    // useLoadRobot; firing GET /scene here would race and clobber it.
    localStorage.setItem('thalos:task:robotId', 'scara')

    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).not.toHaveBeenCalled()
  })

  it('does not request GET /scene when the scene already confirms an identity', () => {
    useSceneStore.setState({ runtime: runtime('scara') })

    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).not.toHaveBeenCalled()
  })
})
