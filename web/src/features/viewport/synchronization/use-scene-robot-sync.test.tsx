// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useSceneRobotSync, shouldRequestRobot } from './use-scene-robot-sync'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import type { RuntimeInfo } from '../types'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  loadScene: vi.fn(),
  // Lifecycle state of the loadRobot mutation — flipped by the error-settle test
  // to simulate a failed load (confirmed identity never changes).
  robotMutation: { isError: false },
  // Lifecycle state of the loadScene mutation — flipped to simulate a failed
  // backend-derived default boot (recovery re-fire).
  sceneMutation: { isError: false },
}))

vi.mock('./use-scene-loader', () => ({
  useLoadRobot: () => ({ mutate: mocks.mutate, isPending: false, isError: mocks.robotMutation.isError }),
  useLoadScene: () => ({ mutate: mocks.loadScene, isPending: false, isError: mocks.sceneMutation.isError }),
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

  it('does NOT loop forever when the same robot load keeps failing (bounded retry after error)', () => {
    // CRITICAL R3-001: resetting the latch on every isError flip re-fires the
    // request effect (the useMutation object is fresh per render), hammering
    // POST /scene/robot with no backoff while the load keeps failing. At most
    // ONE automatic re-request per selection is allowed; a persistent failure
    // must not produce a request storm.
    useSceneStore.setState({ runtime: runtime('planar_3r') })
    const { rerender } = renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))
    expect(mocks.mutate).toHaveBeenCalledTimes(1)

    // First failure settle → one bounded automatic re-request (re-render with
    // the mutation's error state, mirroring react-query's per-render identity).
    mocks.robotMutation.isError = true
    rerender()
    expect(mocks.mutate).toHaveBeenCalledTimes(2)

    // Second failure settle → the retry budget for this selection is spent:
    // no further mutate calls, no request storm.
    mocks.robotMutation.isError = false
    rerender()
    mocks.robotMutation.isError = true
    rerender()
    expect(mocks.mutate).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh retry after the user changes selection (retry budget resets)', () => {
    useSceneStore.setState({ runtime: runtime('planar_3r') })
    const { rerender } = renderHook(() => useSceneRobotSync())

    act(() => useRobotStore.getState().select('scara'))
    mocks.robotMutation.isError = true
    rerender()
    expect(mocks.mutate).toHaveBeenCalledTimes(2)

    // User moves to another robot and back — the retry budget resets, so the
    // same failing robot can be requested again (manual recovery path).
    act(() => useRobotStore.getState().select(null))
    act(() => useRobotStore.getState().select('planar_3r'))
    act(() => useRobotStore.getState().select('scara'))
    expect(mocks.mutate).toHaveBeenCalledTimes(3)
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

  it('loads via GET /scene as the ONLY path when nothing is confirmed (no hint mechanism)', () => {
    // RobotSelector (and its ROBOT_SELECTION_KEY hint) was removed — the catalog
    // is the single source of selection (frontend-task-workspace spec). No
    // localStorage hint exists anymore: GET /scene is the only load path for the
    // backend-derived default, and it must fire exactly once on mount.
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

  it('re-arms the GET /scene latch after a failed boot so a recovered backend can re-initialize', () => {
    // If GET /scene fails durably (retry: 1 exhausted) with no confirmed
    // identity, the `initialSceneRequested` latch stays set forever — a
    // recovered backend could never re-initialize the scene. The latch must
    // re-arm once the failure settles.
    const { rerender } = renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).toHaveBeenCalledTimes(1)

    mocks.sceneMutation.isError = true
    rerender()
    expect(mocks.loadScene).toHaveBeenCalledTimes(2)

    // Backend recovers — the re-fired GET /scene is now idle; no further calls.
    mocks.sceneMutation.isError = false
    rerender()
    expect(mocks.loadScene).toHaveBeenCalledTimes(2)
  })

  it('bounds the automatic GET /scene re-fire so a persistently failing backend does not loop', () => {
    // The re-arm is a bounded recovery, not a retry storm: while the backend
    // stays down, at most a fixed number of re-fires are allowed.
    const { rerender } = renderHook(() => useSceneRobotSync())

    expect(mocks.loadScene).toHaveBeenCalledTimes(1)

    // First failure → one re-arm/re-fire.
    mocks.sceneMutation.isError = true
    rerender()
    expect(mocks.loadScene).toHaveBeenCalledTimes(2)

    // Second failure → second re-arm/re-fire.
    mocks.sceneMutation.isError = false
    rerender()
    mocks.sceneMutation.isError = true
    rerender()
    expect(mocks.loadScene).toHaveBeenCalledTimes(3)

    // Budget exhausted — backend stays down, no further re-fires (no loop).
    mocks.sceneMutation.isError = false
    rerender()
    mocks.sceneMutation.isError = true
    rerender()
    expect(mocks.loadScene).toHaveBeenCalledTimes(3)
  })
})

describe('shouldRequestRobot — pure request decision (spec R2.1 + retry budget)', () => {
  it('requests when the selection is not confirmed and not yet requested', () => {
    expect(shouldRequestRobot('scara', 'planar_3r', null, false)).toBe(true)
  })

  it('does NOT request a robot the scene already confirms', () => {
    expect(shouldRequestRobot('scara', 'scara', null, false)).toBe(false)
  })

  it('does NOT request a robot already latched as requested for this selection', () => {
    expect(shouldRequestRobot('scara', 'planar_3r', 'scara', false)).toBe(false)
  })

  it('requests again after an error settle that granted the one automatic retry (latch cleared)', () => {
    // Error settle: budget not yet consumed → the latch is cleared and the
    // budget spent in the same step, so the pending retry fires once.
    expect(shouldRequestRobot('scara', 'planar_3r', null, true)).toBe(true)
  })

  it('does NOT request again after the retry budget was spent and the latch re-set', () => {
    // The retry also failed → budget consumed, latch re-set to the selection:
    // no more automatic requests until the user changes the selection.
    expect(shouldRequestRobot('scara', 'planar_3r', 'scara', true)).toBe(false)
  })

  it('requests after the selection changed (budget reset, latch cleared)', () => {
    expect(shouldRequestRobot('scara', 'planar_3r', null, false)).toBe(true)
  })

  it('never requests for a null selection', () => {
    expect(shouldRequestRobot(null, 'planar_3r', null, false)).toBe(false)
  })
})
