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

describe('sceneApi.selectToolFrame — POST /scene/tcp (tcp-resolved-pose R2)', () => {
  it('selects frame_id=2 with offset [0,0,0.1] and returns the updated state', async () => {
    mocks.post.mockResolvedValue({ data: runtimeResponse })

    await sceneApi.selectToolFrame(2, [0, 0, 0.1])

    expect(mocks.post).toHaveBeenCalledWith('/scene/tcp', { frame_id: 2, offset: [0, 0, 0.1] })
  })

  it('clears the TCP with null frame_id and null offset (R2 clear scenario)', async () => {
    mocks.post.mockResolvedValue({ data: runtimeResponse })

    await sceneApi.selectToolFrame(null)

    expect(mocks.post).toHaveBeenCalledWith('/scene/tcp', { frame_id: null, offset: null })
  })
})

describe('sceneApi.startExecution — mode body shape (execution-mode-repeat R7)', () => {
  beforeEach(() => {
    mocks.post.mockResolvedValue({ data: runtimeResponse })
  })

  it('sends NO body when mode is absent (legacy → Once)', async () => {
    await sceneApi.startExecution()
    expect(mocks.post).toHaveBeenCalledWith('/scene/motion/start', undefined)
  })

  it('wraps once in { mode: ... }', async () => {
    await sceneApi.startExecution('once')
    expect(mocks.post).toHaveBeenCalledWith('/scene/motion/start', { mode: 'once' })
  })

  it('wraps repeat in { mode: { repeat: { count } } } — the backend shape', async () => {
    await sceneApi.startExecution({ repeat: { count: 5 } })
    expect(mocks.post).toHaveBeenCalledWith('/scene/motion/start', {
      mode: { repeat: { count: 5 } },
    })
  })
})
