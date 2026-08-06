import { useEffect, useRef, useState } from 'react'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import {
  buildTrajectorySegments,
  createProjector,
  hitTestSegment,
  ORBIT_IDENTITY,
  severityAtWaypoint,
  severityColor,
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_NEUTRAL,
  TRAJECTORY_COLOR_WARNING,
  type Orbit,
  type Vec3,
} from './trajectory-projection'

const CANVAS_WIDTH = 640
const CANVAS_HEIGHT = 240
const ORBIT_STEP = 0.025

/**
 * TrajectoryView — lightweight standalone trajectory chart for /evaluation.
 *
 * The R3F viewport is hidden on this route by design, so this view renders the
 * FULL evaluated trajectory on a small dedicated 2D canvas with a weak
 * perspective projection (see trajectory-projection.ts): orbitable by drag
 * (yaw/pitch), problem regions colored by severity (red/amber/blue) over a
 * neutral base, single-waypoint regions highlighted as colored dots.
 *
 * Click-picking is wired to the analysis store's `selectRegion` so chart and
 * ProblemRegions/RegionInspector stay in sync (select ↔ select).
 */
export function TrajectoryView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [orbit, setOrbit] = useState<Orbit>(ORBIT_IDENTITY)
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const waypoints = useSceneStore((s) => s.activePlan?.visualization?.waypoints)
  const report = useAnalysisStore((s) => s.report)
  const selectedRegionId = useAnalysisStore((s) => s.selectedRegionId)
  const selectRegion = useAnalysisStore((s) => s.selectRegion)

  const points: Vec3[] = (waypoints ?? []).map((w) => ({
    x: w.position[0],
    y: w.position[1],
    z: w.position[2],
  }))
  const regions = report?.problem_regions ?? []

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const { width, height } = canvas
    context.clearRect(0, 0, width, height)

    const segments = buildTrajectorySegments(points, regions, width, height, orbit)

    // Base grid is implicit: draw neutral segments first (thin), then severity
    // segments (thicker), then the selected segment highlighted on top.
    for (const segment of segments) {
      const selected = segment.regionId !== null && segment.regionId === selectedRegionId
      context.strokeStyle = selected ? '#ffffff' : segment.color
      context.lineWidth = selected ? 3.5 : segment.severity === 'clean' ? 1.5 : 2.5
      context.globalAlpha = selected ? 1 : segment.severity === 'clean' ? 0.65 : 1
      context.beginPath()
      context.moveTo(segment.projectedStart.x, segment.projectedStart.y)
      context.lineTo(segment.projectedEnd.x, segment.projectedEnd.y)
      context.stroke()
    }
    context.globalAlpha = 1

    // Waypoint dots — severity color inside a region, neutral otherwise.
    const projector = createProjector(points, width, height, orbit)
    for (let i = 0; i < points.length; i++) {
      const severity = severityAtWaypoint(regions, i)
      const p = projector(points[i])
      context.fillStyle = severity === 'clean'
        ? TRAJECTORY_COLOR_NEUTRAL
        : severityColor(severity)
      context.beginPath()
      context.arc(p.x, p.y, severity === 'clean' ? 2 : 3, 0, Math.PI * 2)
      context.fill()
    }
  }, [points, regions, orbit, selectedRegionId])

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    setOrbit({ yaw: drag.yaw + dx * ORBIT_STEP, pitch: drag.pitch + dy * ORBIT_STEP })
  }

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (canvas && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const segments = buildTrajectorySegments(points, regions, canvas.width, canvas.height, orbit)
    const hit = hitTestSegment(segments, x, y)
    selectRegion(hit?.regionId ?? null)
  }

  if (!points.length) {
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
        <span className="text-[10px] text-muted-foreground">drag to orbit</span>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        role="img"
        aria-label="Trajectory with problem regions"
        className="w-full h-48 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={handleClick}
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
