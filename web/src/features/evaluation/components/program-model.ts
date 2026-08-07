import { severityOf } from '@/shared/charts/trajectory3d'
import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'
import type { ProgramEditWire } from '@/shared/contracts/program-edit'
import type { FrameIdDto, MotionSegmentSourceDto } from '@/features/viewport/api/scene-api.types'
import type { SegmentInfo } from '@/features/viewport/types'

/**
 * Program view model — pure functions for the structured program list (CDD
 * step 2, /evaluation). The segment↔region connection: a segment S covers
 * waypoints [S.waypointStart, S.waypointEnd]; a region R covers
 * [R.waypoint_start, R.waypoint_end]; S and R overlap iff the intervals
 * intersect. Deliberately a coarse interval test — the editor (step 3) drills
 * into the exact waypoint.
 */

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 } as const

/** Regions whose waypoint interval intersects the segment's waypoint range. */
export function overlappingRegions(
  segment: SegmentInfo,
  regions: ProblemRegionWire[],
): ProblemRegionWire[] {
  return regions.filter(
    (region) =>
      region.waypoint_start <= segment.waypointEnd && region.waypoint_end >= segment.waypointStart,
  )
}

/** Most severe overlapping region (tie-break: lowest id), or null when clean. */
export function worstRegion(regions: ProblemRegionWire[]): ProblemRegionWire | null {
  let best: ProblemRegionWire | null = null
  for (const region of regions) {
    if (best === null) {
      best = region
      continue
    }
    const rank = SEVERITY_RANK[severityOf(region) as keyof typeof SEVERITY_RANK]
    const bestRank = SEVERITY_RANK[severityOf(best) as keyof typeof SEVERITY_RANK]
    if (rank > bestRank || (rank === bestRank && region.id < best.id)) best = region
  }
  return best
}

/** Program instruction label derived from the canonical source variant. */
export function segmentType(source: MotionSegmentSourceDto): string {
  if ('MoveJ' in source) return 'MoveJ'
  if ('MoveL' in source) return 'MoveL'
  return 'MoveLPosition'
}

/** Compact frame label: 'World' or a numbered frame `#N`. */
export function frameLabel(frame: FrameIdDto): string {
  return typeof frame === 'string' ? frame : `#${frame.Id}`
}

/** Compact one-line summary of the segment's target, e.g. `World [1.25, -0.50, 0.75]`. */
export function sourceSummary(source: MotionSegmentSourceDto): string {
  const fmt = (n: number): string => n.toFixed(2)
  if ('MoveJ' in source) return `[${source.MoveJ.target.map(fmt).join(', ')}]`
  if ('MoveL' in source) {
    const t = source.MoveL.target_pose.transform.translation
    return `${frameLabel(source.MoveL.frame)} [${fmt(t.x)}, ${fmt(t.y)}, ${fmt(t.z)}]`
  }
  const t = source.MoveLPosition.target_position
  return `${frameLabel(source.MoveLPosition.frame)} [${fmt(t[0])}, ${fmt(t[1])}, ${fmt(t[2])}]`
}

/** Region a click on the segment should select: toggle off the currently
 *  selected region when it overlaps, else the worst overlapping region, or
 *  null (clear) when the segment is clean. */
export function clickRegionId(
  segment: SegmentInfo,
  regions: ProblemRegionWire[],
  selectedId: number | null,
): number | null {
  const overlapping = overlappingRegions(segment, regions)
  if (overlapping.length === 0) return null
  if (overlapping.some((region) => region.id === selectedId)) return null
  return worstRegion(overlapping)?.id ?? null
}

// ── Segment edit (CDD step 3 — free-form ProgramEdit trigger) ─────────────

/**
 * Build the semantic `ProgramEdit` for a segment retarget (CDD step 3). One
 * operation per segment kind, using the variant that EXACTLY describes the
 * edit (design D1):
 * - MoveJ → `MoveWaypoint` (retarget the joint-space waypoint).
 * - MoveLPosition → `ReplaceSegment` (swap the segment payload — `MoveWaypoint`
 *   rejects MoveL/MoveLPosition with `WrongSegmentKind`, and no other variant
 *   retargets a Cartesian position cleanly).
 * - MoveL → `ReplaceSegment` position-only fallback (hotfix): no variant
 *   expresses a full pose edit cleanly, but the translation-only retarget maps
 *   exactly onto `MoveLPosition` (see `buildMoveLPositionEdit`). Orientation is
 *   intentionally NOT editable — documented tradeoff.
 */
export function buildSegmentEdit(segment: SegmentInfo, draft: number[]): ProgramEditWire {
  const index = segment.segmentIndex
  if ('MoveJ' in segment.source) {
    const target = segment.source.MoveJ.target
    return {
      MoveWaypoint: {
        segment_index: index,
        new_target: draft,
        old_target: target,
      },
    }
  }
  if ('MoveL' in segment.source) {
    return buildMoveLPositionEdit(segment, [draft[0], draft[1], draft[2]])
  }
  const s = segment.source.MoveLPosition
  return {
    ReplaceSegment: {
      index,
      replacement: [
        {
          MoveLPosition: {
            origin: s.origin,
            frame: s.frame,
            target_position: [draft[0], draft[1], draft[2]],
            max_velocity: s.max_velocity,
          },
        },
      ],
    },
  }
}

/**
 * Position-only fallback for a MoveL edit (hotfix): a full pose edit has no
 * clean `ProgramEdit` variant, but a translation-only retarget maps exactly
 * onto `MoveLPosition`. Derives the position-only segment from the source
 * MoveL, preserving origin / frame / max_velocity and swapping the target
 * pose translation for `newPosition`. The backend resolves `MoveLPosition`
 * via `IKGoal::Position` — the fallback that converges on SCARA-like robots
 * where a full-pose `IKGoal::Pose` would exhaust MaxIterations.
 */
export function buildMoveLPositionEdit(
  segment: SegmentInfo,
  newPosition: [number, number, number],
): ProgramEditWire {
  if (!('MoveL' in segment.source)) {
    throw new Error(
      `buildMoveLPositionEdit expects a MoveL segment (got segment ${segment.segmentIndex})`,
    )
  }
  const s = segment.source.MoveL
  return {
    ReplaceSegment: {
      index: segment.segmentIndex,
      replacement: [
        {
          MoveLPosition: {
            origin: s.origin,
            frame: s.frame,
            target_position: newPosition,
            max_velocity: s.max_velocity,
          },
        },
      ],
    },
  }
}
