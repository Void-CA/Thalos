// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLoadScene, useLoadRobot, useLoadRobotFromUrdf, resetSceneRequestOrdering } from './use-scene-loader'
import { useSceneStore } from '../store'
import type { SceneSnapshot } from '../services/scene.service'
import type { SceneData } from '../types'

const mocks = vi.hoisted(() => ({
  loadScene: vi.fn(),
  loadRobot: vi.fn(),
  loadRobotFromUrdf: vi.fn(),
}))

vi.mock('../services/service-context', () => ({
  useSceneService: () => ({
    loadScene: mocks.loadScene,
    loadRobot: mocks.loadRobot,
    loadRobotFromUrdf: mocks.loadRobotFromUrdf,
  }),
}))

function snapshot(robotId: string): SceneSnapshot {
  return {
    scene: {} as SceneData,
    runtime: {
      robot: { id: robotId, display_name: 'Planar 2R', dof: 2, joints: [] },
      joints: [],
      generatedAt: '2026-08-04T00:00:00Z',
    },
    ikResult: null,
    activePlan: null,
    activeTcp: null,
    execution: null,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  // retryDelay: 0 — keep retries immediate in tests so error surfacing is
  // deterministic. Note: retry:false here is only the CLIENT default — the
  // loadScene mutation sets its own `retry: 1`, which OVERRIDES the client
  // default, so the transient-failure retry test still exercises the real
  // retry path (loadScene is called twice, the scene is applied on retry).
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false, retryDelay: 0 } } })}>
      {children}
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSceneRequestOrdering()
  useSceneStore.getState().reset()
})

describe('useLoadScene — initial identity from GET /scene (spec R7)', () => {
  it('applies the backend scene snapshot (default robot identity) on success', async () => {
    mocks.loadScene.mockResolvedValue(snapshot('planar_2r'))

    const { result } = renderHook(() => useLoadScene(), { wrapper })

    act(() => {
      result.current.mutate()
    })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('planar_2r')
    })
  })

  it('surfaces the backend error into the scene store on failure', async () => {
    mocks.loadScene.mockRejectedValue(new Error('backend unreachable'))

    const { result } = renderHook(() => useLoadScene(), { wrapper })

    act(() => {
      result.current.mutate()
    })

    await waitFor(() => {
      expect(useSceneStore.getState().error).toBe('backend unreachable')
    })
  })

  it('retries a transient GET /scene failure and applies the scene on the retry', async () => {
    // The loadScene mutation carries `retry: 1` (review fix R4-003): a one-shot
    // backend blip must not leave the viewport uninitialized without a retry.
    mocks.loadScene
      .mockRejectedValueOnce(new Error('temporary backend blip'))
      .mockResolvedValueOnce(snapshot('planar_2r'))

    const { result } = renderHook(() => useLoadScene(), { wrapper })

    act(() => {
      result.current.mutate()
    })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('planar_2r')
    })
    expect(mocks.loadScene).toHaveBeenCalledTimes(2)
  })
})

describe('useLoadRobot / useLoadRobotFromUrdf — stale response ordering (review fix)', () => {
  it('discards a loadRobot response superseded by a URDF import that resolved first', async () => {
    // A in flight → URDF import supersedes it → A's response arrives LAST.
    // Without an ordering guard, applyScene would revert the URDF identity.
    let releaseScara!: (s: SceneSnapshot) => void
    mocks.loadRobot.mockReturnValue(new Promise((resolve) => { releaseScara = resolve }))
    mocks.loadRobotFromUrdf.mockResolvedValue(snapshot('urdf:a3f8b2c1d4e5'))

    const { result: robot } = renderHook(() => useLoadRobot(), { wrapper })
    const { result: urdf } = renderHook(() => useLoadRobotFromUrdf(), { wrapper })

    act(() => { robot.current.mutate('scara') })
    act(() => { urdf.current.mutate('<urdf source/>') })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('urdf:a3f8b2c1d4e5')
    })

    // Stale scara response resolves AFTER the URDF snapshot was applied.
    act(() => { releaseScara(snapshot('scara')) })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('urdf:a3f8b2c1d4e5')
    })
  })

  it('discards a stale GET /scene response when a catalog load already confirmed the identity', async () => {
    // GET /scene fired at boot (no confirmed identity) while a loadRobot(scara)
    // raced it. If the scene response resolves last with the backend default,
    // it must NOT clobber the identity the user requested.
    let releaseScene!: (s: SceneSnapshot) => void
    mocks.loadScene.mockReturnValue(new Promise((resolve) => { releaseScene = resolve }))
    mocks.loadRobot.mockResolvedValue(snapshot('scara'))

    const { result: scene } = renderHook(() => useLoadScene(), { wrapper })
    const { result: robot } = renderHook(() => useLoadRobot(), { wrapper })

    act(() => { scene.current.mutate() })
    act(() => { robot.current.mutate('scara') })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('scara')
    })

    // Stale backend-default response resolves last — must be discarded.
    act(() => { releaseScene(snapshot('planar_2r')) })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('scara')
    })
  })

  it('discards a stale loadRobot(A) when a newer loadRobot(B) resolved first (A→B interleave)', async () => {
    // Finding R4-001: two rapid catalog selections A then B. B's response wins
    // (identitySeq supersedes A's token); A's deferred response must NOT revert
    // the confirmed identity back to A when it resolves last.
    let releaseA!: (s: SceneSnapshot) => void
    mocks.loadRobot
      .mockReturnValueOnce(new Promise((resolve) => { releaseA = resolve }))
      .mockResolvedValueOnce(snapshot('planar_3r'))

    const { result } = renderHook(() => useLoadRobot(), { wrapper })

    act(() => {
      result.current.mutate('scara')
      result.current.mutate('planar_3r')
    })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('planar_3r')
    })

    // Stale A response resolves AFTER B was applied — must be discarded.
    act(() => { releaseA(snapshot('scara')) })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('planar_3r')
    })
  })

  it('discards a stale loadRobot(A) ERROR when a URDF import superseded it (token-guarded onError)', async () => {
    // A catalog load (loadRobot) is in flight when a URDF import (separate
    // mutation) supersedes it and succeeds. A then FAILS: without an ordering
    // guard in onError, the stale failure would overwrite the scene error state
    // that the URDF success cleared.
    let rejectA!: (e: Error) => void
    mocks.loadRobot.mockReturnValue(new Promise((_, reject) => { rejectA = reject }))
    mocks.loadRobotFromUrdf.mockResolvedValue(snapshot('urdf:a3f8b2c1d4e5'))

    const { result: robot } = renderHook(() => useLoadRobot(), { wrapper })
    const { result: urdf } = renderHook(() => useLoadRobotFromUrdf(), { wrapper })

    act(() => { robot.current.mutate('scara') })
    act(() => { urdf.current.mutate('<urdf source/>') })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('urdf:a3f8b2c1d4e5')
    })

    // Stale scara failure resolves LAST. Wait for the loadRobot mutation to
    // settle its error (that is what fires onError) — a synchronous assert right
    // after rejectA can miss the microtask. The stale failure must NOT overwrite
    // the scene error state that the URDF success cleared.
    act(() => { rejectA(new Error('stale scara failure')) })
    await waitFor(() => {
      expect(robot.current.isError).toBe(true)
    })

    expect(useSceneStore.getState().error).toBeNull()
  })

  it('discards a stale GET /scene ERROR when a catalog load superseded it (token-guarded onError)', async () => {
    let rejectScene!: (e: Error) => void
    mocks.loadScene.mockReturnValue(new Promise((_, reject) => { rejectScene = reject }))
    mocks.loadRobot.mockResolvedValue(snapshot('scara'))

    const { result: scene } = renderHook(() => useLoadScene(), { wrapper })
    const { result: robot } = renderHook(() => useLoadRobot(), { wrapper })

    act(() => { scene.current.mutate() })
    act(() => { robot.current.mutate('scara') })

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('scara')
    })

    // Stale backend-default failure resolves last. Wait for the loadScene
    // mutation to settle its error (retry: 1 exhausted) — that is what fires
    // onError — before asserting the scene error was not overwritten.
    act(() => { rejectScene(new Error('stale scene failure')) })
    await waitFor(() => {
      expect(scene.current.isError).toBe(true)
    })

    expect(useSceneStore.getState().error).toBeNull()
  })
})
