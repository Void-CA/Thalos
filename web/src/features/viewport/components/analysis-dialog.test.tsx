// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnalysisDialog } from './analysis-dialog'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'

const mocks = vi.hoisted(() => ({
  sample: vi.fn(),
  analyzeSingularity: vi.fn(),
  analyzeManipulability: vi.fn(),
}))

vi.mock('../services/service-context', () => ({
  useWorkspaceService: () => ({
    sample: mocks.sample,
    analyzeSingularity: mocks.analyzeSingularity,
    analyzeManipulability: mocks.analyzeManipulability,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  useRobotStore.getState().setRobots([])
  useRobotStore.getState().select(null)
  useSceneStore.getState().reset()
})

describe('AnalysisDialog — always targets the scene robot via /active endpoints (spec R3)', () => {
  it('passes null as robot id to all three analysis services even when a catalog robot is selected', async () => {
    // A catalog robot IS selected — but analysis must target the scene chain
    // (/active), not the catalog selection (R3, design D7).
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AnalysisDialog open samples={120} seed={7} tolerance={0.05} onClose={() => {}} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 120, seed: 7, tolerance: 0.05 })
    })
    await waitFor(() => {
      expect(mocks.analyzeSingularity).toHaveBeenCalledWith(null, { samples: 120, seed: 7, tolerance: 0.05 })
    })
    await waitFor(() => {
      expect(mocks.analyzeManipulability).toHaveBeenCalledWith(null, { samples: 120, seed: 7, tolerance: 0.05 })
    })
  })

  it('passes null robot id even with no catalog selection (R3: /active is unconditional)', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <AnalysisDialog open samples={200} seed={3} tolerance={0.01} onClose={() => {}} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 200, seed: 3, tolerance: 0.01 })
    })
    await waitFor(() => {
      expect(mocks.analyzeSingularity).toHaveBeenCalledWith(null, { samples: 200, seed: 3, tolerance: 0.01 })
    })
    await waitFor(() => {
      expect(mocks.analyzeManipulability).toHaveBeenCalledWith(null, { samples: 200, seed: 3, tolerance: 0.01 })
    })
  })

  it('targets /active with null robot id when the SCENE holds a URDF robot (R3 chain targeting)', async () => {
    // A URDF robot is confirmed in the scene runtime. Analysis MUST still
    // target the scene chain (/workspace/sample/active) — never capture the
    // URDF identity nor any catalog selection (spec R3: URDF analyzed via chain).
    useSceneStore.setState({
      runtime: { robot: { id: 'urdf:a3f8b2c1d4e5', display_name: 'My URDF Robot', dof: 2, joints: [] }, joints: [], generatedAt: '2026-08-04T00:00:00Z' },
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <AnalysisDialog open samples={80} seed={11} tolerance={0.02} onClose={() => {}} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 80, seed: 11, tolerance: 0.02 })
    })
    await waitFor(() => {
      expect(mocks.analyzeSingularity).toHaveBeenCalledWith(null, { samples: 80, seed: 11, tolerance: 0.02 })
    })
    await waitFor(() => {
      expect(mocks.analyzeManipulability).toHaveBeenCalledWith(null, { samples: 80, seed: 11, tolerance: 0.02 })
    })
  })
})
