// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLoadScene } from './use-scene-loader'
import { useSceneStore } from '../store'
import type { SceneSnapshot } from '../services/scene.service'
import type { SceneData } from '../types'

const mocks = vi.hoisted(() => ({
  loadScene: vi.fn(),
}))

vi.mock('../services/service-context', () => ({
  useSceneService: () => ({ loadScene: mocks.loadScene }),
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
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
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
