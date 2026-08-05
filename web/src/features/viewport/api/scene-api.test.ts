// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sceneApi } from './scene-api'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/shared/api-client', () => ({
  apiClient: { get: mocks.get, post: mocks.post },
}))

const runtimeResponse = {
  robot: { id: 'planar_2r', display_name: 'Planar 2R', dof: 2, joints: [] },
  joints: [0, 0],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  generated_at: '2026-08-04T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sceneApi.getScene — backend-derived initial identity (spec R7)', () => {
  it('GETs /scene and returns the raw RuntimeStateResponse', async () => {
    mocks.get.mockResolvedValue({ data: runtimeResponse })

    await expect(sceneApi.getScene()).resolves.toEqual(runtimeResponse)
    expect(mocks.get).toHaveBeenCalledWith('/scene')
  })
})
