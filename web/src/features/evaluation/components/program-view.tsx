import { useMemo } from 'react'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import { severityOf } from '@/shared/charts/trajectory3d'
import {
  clickRegionId,
  overlappingRegions,
  segmentType,
  sourceSummary,
  worstRegion,
} from './program-model'

/**
 * ProgramView — structured, NON-editable view of the active plan's motion
 * program (CDD step 2, /evaluation). The bridge from "this region has a
 * problem" to "this is the program segment I must edit": each segment row
 * renders its source intent (MoveJ / MoveL / MoveLPosition), the waypoint
 * range it covers and a severity badge when that range overlaps a problem
 * region. Selecting a region (list, inspector or trajectory) highlights the
 * overlapping segment(s); clicking a segment selects its worst overlapping
 * region — selection flows both ways through the analysis store.
 */

export function ProgramView() {
  const segments = useSceneStore((s) => s.activePlan?.segments)
  const report = useAnalysisStore((s) => s.report)
  const selectedRegionId = useAnalysisStore((s) => s.selectedRegionId)
  const selectRegion = useAnalysisStore((s) => s.selectRegion)

  const regions = useMemo(() => report?.problem_regions ?? [], [report])
  const list = segments ?? []

  if (list.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Program</span>
        <div
          data-testid="program-empty"
          className="text-xs text-muted-foreground text-center py-4 rounded-lg border border-dashed border-border bg-card/30"
        >
          No program segments to display.
        </div>
      </section>
    )
  }

  return (
    <section
      data-testid="program-view"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Program</span>
        <span className="text-[10px] text-muted-foreground">
          click a segment to select its problem region
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {list.map((segment) => {
          const overlapping = overlappingRegions(segment, regions)
          const worst = worstRegion(overlapping)
          const selected = selectedRegionId !== null && overlapping.some((r) => r.id === selectedRegionId)
          return (
            <li key={segment.segmentIndex}>
              <button
                data-testid={`program-segment-${segment.segmentIndex}`}
                data-selected={selected || undefined}
                data-severity={worst ? severityOf(worst) : undefined}
                onClick={() => selectRegion(clickRegionId(segment, regions, selectedRegionId))}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-left transition-all cursor-pointer
                  ${selected ? 'ring-1 ring-primary-mid border-primary-mid' : 'hover:bg-secondary/40'}`}
              >
                <span className="font-mono text-[10px] text-muted-foreground w-7 shrink-0 tabular-nums">
                  [{segment.segmentIndex}]
                </span>
                <span className="text-xs font-semibold text-foreground w-28 shrink-0">
                  {segmentType(segment.source)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground truncate flex-1">
                  {sourceSummary(segment.source)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  wp{segment.waypointStart}–wp{segment.waypointEnd}
                </span>
                {worst && <SeverityBadge tier={severityOf(worst)} />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const BADGE_STYLES = {
  critical: 'bg-destructive-weak text-destructive',
  warning: 'bg-warning-weak text-chart-4',
  info: 'bg-muted text-muted-foreground',
  clean: 'bg-muted text-muted-foreground',
} as const

const BADGE_LABELS = { critical: 'Critical', warning: 'Warning', info: 'Info', clean: 'Info' } as const

function SeverityBadge({ tier }: { tier: keyof typeof BADGE_LABELS }) {
  return (
    <span
      data-testid="severity-badge"
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${BADGE_STYLES[tier]}`}
    >
      {BADGE_LABELS[tier]}
    </span>
  )
}
