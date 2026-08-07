import { describe, it, expect } from 'vitest'
import { buildMoveLPositionEdit, buildSegmentEdit } from './program-model'
import type { SegmentInfo } from '@/features/viewport/types'

/**
 * Hotfix (MoveL position-only fallback): a MoveL segment has no clean
 * full-pose `ProgramEdit` variant, so editing routes through
 * `ReplaceSegment` with a `MoveLPosition` derived from the source MoveL —
 * origin / frame / max_velocity preserved, only the translation retargeted.
 * The backend resolves `MoveLPosition` via `IKGoal::Position` (position-only),
 * the fallback that converges on SCARA-like robots where a full-pose
 * `IKGoal::Pose` would exhaust MaxIterations.
 */

const moveLSegment: SegmentInfo = {
  segmentIndex: 1,
  motionType: 'LINE',
  waypointStart: 3,
  waypointEnd: 4,
  timeStart: 1,
  timeEnd: 2,
  source: {
    MoveL: {
      origin: 'base',
      frame: 'World',
      target_pose: {
        reference: 'World',
        target: 'World',
        transform: {
          translation: { x: 1.25, y: -0.5, z: 0.75 },
          rotation: { q: { w: 1, x: 0, y: 0, z: 0 } },
        },
      },
      max_velocity: 200,
    },
  },
}

describe('buildMoveLPositionEdit — position-only fallback', () => {
  it('builds a ReplaceSegment with a MoveLPosition retargeted to the new position', () => {
    const edit = buildMoveLPositionEdit(moveLSegment, [2.0, -1.0, 0.5])
    expect(edit).toEqual({
      ReplaceSegment: {
        index: 1,
        replacement: [
          {
            MoveLPosition: {
              origin: 'base',
              frame: 'World',
              target_position: [2.0, -1.0, 0.5],
              max_velocity: 200,
            },
          },
        ],
      },
    })
  })

  it('preserves origin, frame and max_velocity from the source MoveL', () => {
    const edit = buildMoveLPositionEdit(moveLSegment, [0, 0, 0])
    expect('ReplaceSegment' in edit).toBe(true)
    if (!('ReplaceSegment' in edit)) return
    const replacement = edit.ReplaceSegment.replacement[0]
    expect('MoveLPosition' in replacement).toBe(true)
    if ('MoveLPosition' in replacement) {
      expect(replacement.MoveLPosition.origin).toBe('base')
      expect(replacement.MoveLPosition.frame).toBe('World')
      expect(replacement.MoveLPosition.max_velocity).toBe(200)
      expect(replacement.MoveLPosition.target_position).toEqual([0, 0, 0])
    }
  })

  it('buildSegmentEdit routes a MoveL draft through the position-only fallback', () => {
    const edit = buildSegmentEdit(moveLSegment, [2.0, -1.0, 0.5])
    expect(edit).toEqual({
      ReplaceSegment: {
        index: 1,
        replacement: [
          {
            MoveLPosition: {
              origin: 'base',
              frame: 'World',
              target_position: [2.0, -1.0, 0.5],
              max_velocity: 200,
            },
          },
        ],
      },
    })
  })
})
