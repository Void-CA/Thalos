// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { SceneService } from './scene.service'
import type { RuntimeStateResponse } from '../api/scene-api.types'

const tcpResponse: RuntimeStateResponse = {
  robot: { id: 'planar_2r', display_name: 'Planar 2R', dof: 2, joints: [] },
  joints: [0, 0],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  active_tcp: {
    base_frame_id: 2,
    offset: [0, 0, 0.1],
    resolved_pose: { position: [1, 2, 3], orientation: [1, 0, 0, 0] },
  },
  generated_at: '2026-08-04T00:00:00Z',
}

describe('SceneService.selectToolFrame — TCP selection delegation (tcp-resolved-pose R2)', () => {
  it('delegates to api.selectToolFrame and maps activeTcp.resolvedPose', async () => {
    const selectToolFrame = vi.fn().mockResolvedValue(tcpResponse)
    const service = new SceneService({ selectToolFrame } as unknown as SceneService['api'])

    const snapshot = await service.selectToolFrame(2, [0, 0, 0.1])

    expect(selectToolFrame).toHaveBeenCalledWith(2, [0, 0, 0.1])
    expect(snapshot.activeTcp).toEqual({
      baseFrameId: 2,
      offset: [0, 0, 0.1],
      resolvedPose: { position: [1, 2, 3], orientation: [1, 0, 0, 0] },
    })
  })

  it('maps activeTcp null when the API clears the TCP', async () => {
    const selectToolFrame = vi.fn().mockResolvedValue({ ...tcpResponse, active_tcp: null })
    const service = new SceneService({ selectToolFrame } as unknown as SceneService['api'])

    const snapshot = await service.selectToolFrame(null)

    expect(selectToolFrame).toHaveBeenCalledWith(null, undefined)
    expect(snapshot.activeTcp).toBeNull()
  })
})
