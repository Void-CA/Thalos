import { describe, it, expect } from 'vitest'
import { programEditKind, type ProgramEditWire } from './program-edit'
import type { MotionSegmentSourceDto } from '@/features/viewport/api/scene-api.types'

/**
 * CDD step 3 — ProgramEdit wire contract. Pins the typed shape of
 * `thalos_planning::program_edit::ProgramEdit` (externally-tagged serde enum):
 * each variant is a single-key object whose payload mirrors the Rust struct
 * field-for-field. The frontend NEVER invents a parallel HTTP command format —
 * it constructs exactly these objects for POST /plan/program/edit.
 */

const moveJ: MotionSegmentSourceDto = {
  MoveJ: { origin: 'op-j', target: [0.5, -0.3, -0.1, 0.0], max_velocity: 500, max_acceleration: null },
}

describe('ProgramEditWire — typed round-trip shape', () => {
  it('ReplaceSegment carries index + replacement + optional original capture', () => {
    const edit: ProgramEditWire = { ReplaceSegment: { index: 2, replacement: [moveJ], original: null } }
    expect(programEditKind(edit)).toBe('ReplaceSegment')
    const round = JSON.parse(JSON.stringify(edit))
    expect(round).toEqual(edit)
    expect(round.ReplaceSegment.index).toBe(2)
    expect(round.ReplaceSegment.replacement[0].MoveJ.target).toEqual([0.5, -0.3, -0.1, 0.0])
  })

  it('InsertSegments carries at + segments', () => {
    const edit: ProgramEditWire = { InsertSegments: { at: 0, segments: [moveJ] } }
    expect(programEditKind(edit)).toBe('InsertSegments')
    expect(JSON.parse(JSON.stringify(edit))).toEqual(edit)
  })

  it('RemoveSegments carries at + count + optional removed capture', () => {
    const edit: ProgramEditWire = { RemoveSegments: { at: 1, count: 2, removed: [moveJ, moveJ] } }
    expect(programEditKind(edit)).toBe('RemoveSegments')
    expect(JSON.parse(JSON.stringify(edit))).toEqual(edit)
  })

  it('SplitMove carries index + joint-space point', () => {
    const edit: ProgramEditWire = { SplitMove: { index: 0, point: [0.25, 0.0, 0.0, 0.0] } }
    expect(programEditKind(edit)).toBe('SplitMove')
    expect(JSON.parse(JSON.stringify(edit))).toEqual(edit)
  })

  it('MergeMoves carries adjacent first/second + optional originals capture', () => {
    const edit: ProgramEditWire = { MergeMoves: { first: 0, second: 1, originals: [moveJ, moveJ] } }
    expect(programEditKind(edit)).toBe('MergeMoves')
    expect(JSON.parse(JSON.stringify(edit))).toEqual(edit)
  })

  it('MoveWaypoint carries segment_index + new_target + optional old_target capture', () => {
    const edit: ProgramEditWire = {
      MoveWaypoint: { segment_index: 0, new_target: [0.55, -0.3, -0.1, 0.0], old_target: [0.5, -0.3, -0.1, 0.0] },
    }
    expect(programEditKind(edit)).toBe('MoveWaypoint')
    const round = JSON.parse(JSON.stringify(edit))
    expect(round).toEqual(edit)
    expect(round.MoveWaypoint.segment_index).toBe(0)
    expect(round.MoveWaypoint.new_target).toHaveLength(4)
  })
})
