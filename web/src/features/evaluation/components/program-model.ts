import { severityOf } from '@/shared/charts/trajectory3d'
import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'
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
