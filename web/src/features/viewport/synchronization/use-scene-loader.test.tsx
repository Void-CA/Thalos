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
  // retryDelay: 0 — keep the loadScene mutation's production retry:1 but make
  // retries immediate in tests so error surfacing is deterministic.
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
})
