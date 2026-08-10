import { useEffect, useMemo, useRef } from 'react'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import {
  buildTrajectoryOption,
  disposeGLChart,
  mountGLChart,
  resizeGLChart,
} from '@/shared/charts/gl-adapter'
import { minClearanceWaypoint } from '@/shared/contracts/analysis-report'
import {
  buildTrajectoryRuns,
  regionAtWaypoint,
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_NEUTRAL,
  TRAJECTORY_COLOR_WARNING,
  type Vec3,
} from '@/shared/charts/trajectory3d'

/**
 * TrajectoryView — ECharts GL line3D trajectory chart for /evaluation
 * (evaluation hotfix CDD).
 *
 * The R3F viewport is hidden on this route by design, so this view renders the
 * FULL evaluated trajectory on a dedicated 3D chart instead of the old
 * hand-rolled 2D canvas projection. It mounts ECharts GL directly through
 * `gl-adapter.ts` (the single echarts-gl frontier — ChartModel is a frozen 2D
 * contract and cannot express line3D). Problem regions are rendered as
 * contiguous line3D runs colored by severity over a neutral base; grid3D gives
 * orbit/rotate/zoom for free.
 *
 * Click-picking maps the clicked line3D point back to its global waypoint
 * index and selects the covering problem region via the analysis store, so the
 * chart and ProblemRegions/RegionInspector stay in sync (select ↔ select).
 */
export function TrajectoryView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof mountGLChart> | null>(null)

  const waypoints = useSceneStore((s) => s.activePlan?.visualization?.waypoints)
  const report = useAnalysisStore((s) => s.report)
  const selectedRegionId = useAnalysisStore((s) => s.selectedRegionId)
  const selectRegion = useAnalysisStore((s) => s.selectRegion)

  const points = useMemo<Vec3[]>(
    () => (waypoints ?? []).map((w) => ({ x: w.position[0], y: w.position[1], z: w.position[2] })),
    [waypoints],
  )
  const regions = useMemo(() => report?.problem_regions ?? [], [report])
  const markerWaypoint = useMemo(
    () => (report ? minClearanceWaypoint(report.metrics) : null),
    [report],
  )

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return

    const chart = mountGLChart(
      el,
      buildTrajectoryOption(points, regions, selectedRegionId, markerWaypoint),
    )
    chartRef.current = chart

    const handleClick = (params: { seriesIndex?: number; dataIndex?: number }) => {
      if (params.seriesIndex === undefined || params.dataIndex === undefined) return
      const run = buildTrajectoryRuns(points, regions)[params.seriesIndex]
      if (run === undefined) return
      const globalIndex = run.waypointStart + params.dataIndex
      selectRegion(regionAtWaypoint(regions, globalIndex)?.id ?? null)
    }
    chart.on('click', handleClick)

    const observer = new ResizeObserver(() => {
      resizeGLChart(el)
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      chart.off('click', handleClick)
      disposeGLChart(el)
      chartRef.current = null
    }
  }, [points, regions, selectedRegionId, markerWaypoint, selectRegion])

  if (points.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 rounded-lg border border-border bg-card/50">
        No trajectory data to display.
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Trajectory
        </span>
        <span className="text-[10px] text-muted-foreground">drag to orbit · scroll to zoom</span>
      </div>
      <div
        ref={containerRef}
        data-testid="trajectory-chart"
        role="img"
        aria-label="Trajectory with problem regions"
        className="h-64 w-full"
      />
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <LegendSwatch color={TRAJECTORY_COLOR_NEUTRAL} label="Clean" />
        <LegendSwatch color={TRAJECTORY_COLOR_WARNING} label="Warning" />
        <LegendSwatch color={TRAJECTORY_COLOR_CRITICAL} label="Critical" />
      </div>
    </section>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
