// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from '@/shared/api-client'
import { WorkspaceService, NEAR_SINGULAR_CONDITION_THRESHOLD } from './workspace-analysis-client'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}))

vi.mock('@/shared/api-client', () => ({
  apiClient: { post: mocks.post },
}))

const sampleParams = { samples: 10, seed: 0, tolerance: 0.001 }

/** Raw wire response of the workspace endpoints (WorkspaceDto/SingularityResponse). */
function wireResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      metrics: {
        sample_count: 10,
        max_reach: 0.5,
        bounding_volume: 0.1,
        centroid: { x: 0, y: 0, z: 0 },
      },
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      samples: [{ position: { x: 0.1, y: 0.2, z: 0.3 } }],
      ...overrides,
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('WorkspaceService — /active targeting for the scene robot (spec R3)', () => {
  it('posts sample(null) to /workspace/sample/active without a robot_id', async () => {
    mocks.post.mockResolvedValue(wireResponse())
    const service = new WorkspaceService(apiClient)

    const result = await service.sample(null, sampleParams)

    expect(mocks.post).toHaveBeenCalledWith('/workspace/sample/active', {
      ...sampleParams,
      include_samples: true,
    })
    expect(result.samples?.[0]?.position).toEqual([0.1, 0.2, 0.3])
  })

  it('posts sample(robotId) to /workspace/sample with robot_id', async () => {
    mocks.post.mockResolvedValue(wireResponse())
    const service = new WorkspaceService(apiClient)

    await service.sample('scara', sampleParams)

    expect(mocks.post).toHaveBeenCalledWith('/workspace/sample', {
      robot_id: 'scara',
      ...sampleParams,
      include_samples: true,
    })
  })

  it('posts analyzeSingularity(null) to /workspace/singularity/active', async () => {
    mocks.post.mockResolvedValue(wireResponse())
    const service = new WorkspaceService(apiClient)

    await service.analyzeSingularity(null, sampleParams)

    expect(mocks.post).toHaveBeenCalledWith('/workspace/singularity/active', {
      ...sampleParams,
      near_singular_condition_threshold: NEAR_SINGULAR_CONDITION_THRESHOLD,
      include_samples: true,
    })
  })

  it('posts analyzeSingularity(robotId) to /workspace/singularity with robot_id', async () => {
    mocks.post.mockResolvedValue(wireResponse())
    const service = new WorkspaceService(apiClient)

    await service.analyzeSingularity('planar_3r', sampleParams)

    expect(mocks.post).toHaveBeenCalledWith('/workspace/singularity', {
      robot_id: 'planar_3r',
      ...sampleParams,
      near_singular_condition_threshold: NEAR_SINGULAR_CONDITION_THRESHOLD,
      include_samples: true,
    })
  })

  it('posts analyzeManipulability(null) to /workspace/manipulability/active', async () => {
    mocks.post.mockResolvedValue(wireResponse())
    const service = new WorkspaceService(apiClient)

    await service.analyzeManipulability(null, sampleParams)

    expect(mocks.post).toHaveBeenCalledWith('/workspace/manipulability/active', {
      ...sampleParams,
      include_samples: true,
    })
  })

  it('posts analyzeManipulability(robotId) to /workspace/manipulability with robot_id', async () => {
    mocks.post.mockResolvedValue(wireResponse())
    const service = new WorkspaceService(apiClient)

    await service.analyzeManipulability('scara', sampleParams)

    expect(mocks.post).toHaveBeenCalledWith('/workspace/manipulability', {
      robot_id: 'scara',
      ...sampleParams,
      include_samples: true,
    })
  })
})
