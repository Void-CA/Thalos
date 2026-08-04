// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useSceneRobotSync } from './use-scene-robot-sync'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import type { RuntimeInfo } from '../types'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  loadScene: vi.fn(),
  // Lifecycle state of the loadRobot mutation — flipped by the error-settle test
  // to simulate a failed load (confirmed identity never changes).
  robotMutation: { isError: false },
}))

vi.mock('./use-scene-loader', () => ({
  useLoadRobot: () => ({ mutate: mocks.mutate, isPending: false, isError: mocks.robotMutation.isError }),
  useLoadScene: () => ({ mutate: mocks.loadScene, isPending: false, isError: false }),
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
  mocks.robotMutation.isError = false
  localStorage.clear()
  useRobotStore.getState().setRobots([
    { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
    { id: 'planar_3r', display_name: 'Planar 3R', dof: 3, joints: [] },
  ])
  useRobotStore.getState().select(null)
  useSceneStore.getState().reset()
})

// No global RTL cleanup in this repo's vitest config — unmount between tests
// so a previous test's mounted hook cannot observe the next test's store state.
afterEach(() => cleanup())

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

  it('re-requests a catalog robot after a URDF import replaced the confirmed identity (dedupe latch reset)', () => {
    // notes.txt workflow: select scara → import URDF → re-select scara. The
    // lastRequested dedupe latch kept 'scara' forever, so the user's re-selection
    // was silently ignored (selectedId !== confirmedId but === lastRequested).
    // Changing the confirmed identity must invalidate the latch.
    useSceneStore.setState({ runtime: runtime('planar_3r') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))
    expect(mocks.mutate).toHaveBeenCalledWith('scara')
    expect(mocks.mutate).toHaveBeenCalledTimes(1)

    // URDF import: RobotCatalog deselects the catalog robot, then the scene
    // confirms the new URDF identity via applyScene.
    act(() => useRobotStore.getState().select(null))
    act(() => useSceneStore.setState({ runtime: runtime('urdf:a3f8b2c1d4e5') }))

    // Re-selecting the same catalog robot must be requested again.
    act(() => useRobotStore.getState().select('scara'))

    expect(mocks.mutate).toHaveBeenCalledTimes(2)
    expect(mocks.mutate).toHaveBeenLastCalledWith('scara')
  })

  it('re-requests a catalog robot after its load failed and the confirmed identity never changed (latch reset on error settle)', () => {
    // select X → loadRobot(X) fails → confirmedId stays the previous robot.
    // The confirmedId-change reset never fires (nothing confirmed changes), so
    // lastRequested keeps X blocked forever: re-selecting X after the catalog
    // clears its selection must still re-request, not stay silent.
    useSceneStore.setState({ runtime: runtime('planar_3r') })
    renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))
    expect(mocks.mutate).toHaveBeenCalledWith('scara')

    // loadRobot(scara) settles with an error — the confirmed identity stays
    // planar_3r, so only the error-settle path can unblock the re-selection.
    mocks.robotMutation.isError = true
    act(() => useRobotStore.getState().select(null))
    act(() => useRobotStore.getState().select('scara'))

    expect(mocks.mutate).toHaveBeenCalledTimes(2)
    expect(mocks.mutate).toHaveBeenLastCalledWith('scara')
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

  it('requests GET /scene when a catalog hint is persisted but nothing is confirmed yet (deadlock fix)', () => {
    // A persisted catalog id is only a REQUEST via RobotSelector's select() —
    // which lives in /task and requires the scene loaded to mount. On '/' the
    // selector never mounts, so GET /scene is the ONLY load path: skipping it
    // on a valid hint deadlocked the boot (viewport empty, /scene and /task
    // bounce back to '/'). The hint must never gate the backend-derived load.
    localStorage.setItem('thalos:task:robotId', 'scara')

    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).toHaveBeenCalledTimes(1)
  })

  it('requests GET /scene even when the catalog is empty/failed — the scene load is decoupled from it', () => {
    // Finding 3: GET /scene was gated on `robots.length > 0` (the catalog
    // fetch) — if GET /robots failed, the scene never initialized. The
    // backend-derived default must fire independently of the catalog.
    useRobotStore.getState().setRobots([])

    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).toHaveBeenCalledTimes(1)
  })

  it('does not request GET /scene when the scene already confirms an identity', () => {
    useSceneStore.setState({ runtime: runtime('scara') })

    renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).not.toHaveBeenCalled()
  })
})
