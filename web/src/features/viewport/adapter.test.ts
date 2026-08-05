// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { toToolFrame } from './adapter'
import type { ToolFrameDto } from './api/scene-api.types'

describe('toToolFrame — maps resolved_pose from ToolFrameDto (tcp-resolved-pose R1/R2)', () => {
  it('maps resolved_pose to resolvedPose when the DTO carries it', () => {
    const dto: ToolFrameDto = {
      base_frame_id: 2,
      offset: [0, 0, 0.1],
      resolved_pose: { position: [1, 2, 3], orientation: [1, 0, 0, 0] },
    }

    expect(toToolFrame(dto)).toEqual({
      baseFrameId: 2,
      offset: [0, 0, 0.1],
      resolvedPose: { position: [1, 2, 3], orientation: [1, 0, 0, 0] },
    })
  })

  it('maps resolvedPose to null when the DTO omits resolved_pose', () => {
    const dto: ToolFrameDto = { base_frame_id: 2 }

    expect(toToolFrame(dto)?.resolvedPose).toBeNull()
    expect(toToolFrame(dto)).toEqual({ baseFrameId: 2, offset: null, resolvedPose: null })
  })

  it('returns null when there is no active TCP', () => {
    expect(toToolFrame(null)).toBeNull()
  })
})
