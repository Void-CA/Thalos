import type { MotionSegmentSourceDto } from '@/features/viewport/api/scene-api.types'

/**
 * Wire shape of `thalos_planning::program_edit::ProgramEdit` — the semantic
 * command language over the motion program (design D1). Externally-tagged
 * serde enum (UPPERCASE variant keys) — the SAME shape that travels inside
 * `recommendations[].edit` and the request body of `POST /plan/program/edit`
 * (CDD step 3). Operations are immutable: `old Program → ProgramEdit → new
 * Program` (fits the preview/apply/undo cycle and backend↔frontend
 * consistency).
 *
 * Field names/optionality mirror the Rust struct EXACTLY — `Option<T>` fields
 * serialize as `null` when unset. `MotionSegmentSourceDto` is the canonical
 * `MotionSegment` wire representation.
 *
 * Semantic notes used by the ProgramView trigger:
 * - `MoveWaypoint` retargets a **MoveJ** segment only (`apply` rejects MoveL /
 *   MoveLPosition with `WrongSegmentKind`).
 * - `ReplaceSegment` swaps the segment at `index` (span 1 when `original` is
 *   unset) — the variant that CAN retarget a MoveLPosition payload.
 * - `MoveL` full-pose editing is NOT expressible through a single clean
 *   variant here — deferred (the ProgramView disables its edit button).
 */
export type ProgramEditWire =
  | {
      ReplaceSegment: {
        index: number
        replacement: MotionSegmentSourceDto[]
        /** Pre-apply range capture (roundtrip inverse). Optional on the wire. */
        original?: MotionSegmentSourceDto[] | null
      }
    }
  | {
      InsertSegments: {
        at: number
        segments: MotionSegmentSourceDto[]
      }
    }
  | {
      RemoveSegments: {
        at: number
        count: number
        /** Removed-segment capture (roundtrip inverse). Optional on the wire. */
        removed?: MotionSegmentSourceDto[] | null
      }
    }
  | {
      SplitMove: {
        index: number
        /** Split waypoint in joint space (at least one joint). */
        point: number[]
      }
    }
  | {
      MergeMoves: {
        first: number
        second: number
        /** Captured originals (roundtrip inverse). Optional on the wire. */
        originals?: [MotionSegmentSourceDto, MotionSegmentSourceDto] | null
      }
    }
  | {
      MoveWaypoint: {
        segment_index: number
        new_target: number[]
        /** Previous target capture (roundtrip inverse). Optional on the wire. */
        old_target?: number[] | null
      }
    }

/** The externally-tagged variant key of a ProgramEdit wire object. */
export function programEditKind(edit: ProgramEditWire): string {
  return Object.keys(edit)[0]
}
