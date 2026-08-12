import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { useAnalysisStore } from '@/features/analysis/store'
import { waypointAnalysisFromReport } from '@/shared/contracts/analysis-report'
import { scaleFromRefDim } from './scale'
import type { VisualWaypointDto } from '../api/scene-api.types'
import {
  SEGMENT_PALETTE,
  WAYPOINT_TYPE,
  TRAJECTORY_LINE,
  WAYPOINT_ACTIVE,
  SEVERITY,
  MANIP_HIGH, MANIP_MED, MANIP_LOW,
  SINGULAR_NORMAL, SINGULAR_NEAR, SINGULAR_SINGULAR,
} from '@/shared/tokens'

/**
 * Trajectory — renders the active plan's trajectory.
 *
 * Shows exactly one of the three according to `trajectoryViewMode`:
 * - `original`  → original trajectory colored by mode
 * - `optimized` → only the optimized trajectory (solid green)
 * - `preview`   → only a recommendation's simulated trajectory (amber,
 *                 PR3 — reuses the `optimized` overlay mechanism)
 *
 * Never more than one at a time — mutually exclusive toggle.
 */
export function Trajectory() {
  const activePlan = useSceneStore(s => s.activePlan)
  const optimizedPositions = useSceneStore(s => s.optimizedPositions)
  const previewPositions = useSceneStore(s => s.previewPositions)
  const trajectoryViewMode = useSceneStore(s => s.trajectoryViewMode)
  const colorMode = useSceneStore(s => s.trajectoryColorMode)
  const transformSnapshot = useSceneStore(s => s.transformSnapshot)
  const execution = useSceneStore(s => s.execution)
  const analysisReport = useAnalysisStore(s => s.report)
  // Marker radii scale with the scene reference dimension — absent scene data
  // degrades to 1.0 via scaleFromRefDim (no-op, current sizes preserved).
  const refDim = useSceneStore(s => s.data?.referenceDimension) ?? 1.0
  const segments = activePlan?.segments
  const vis = activePlan?.visualization

  const analysisWp = useMemo(
    () => (analysisReport ? waypointAnalysisFromReport(analysisReport) : []),
    [analysisReport],
  )

  const hasAnalysis = analysisWp.length > 0 && analysisWp.length === (vis?.waypoints.length ?? 0)

  // Active waypoint: highlighted while execution ticks drive the robot, index
  // derived from the same execution progress that positions the model.
  const activeWaypointIndex = useMemo(() => {
    if (transformSnapshot.kind !== 'execution' || !execution) return -1
    const count = vis?.waypoints.length ?? 0
    if (count === 0) return -1
    const idx = Math.floor(execution.progress * count)
    return Math.min(Math.max(idx, 0), count - 1)
  }, [transformSnapshot.kind, execution, vis])

  const perWaypointColor = useMemo(() => {
    if (!vis || !hasAnalysis || !analysisWp.length || colorMode === 'segment') return null
    return analysisWp.map(wp => {
      switch (colorMode) {
        case 'trajectory-quality':
          return SEVERITY[wp.severity] ?? SEVERITY.nodata
        case 'manipulability':
          if (wp.manipulability == null) return SEVERITY.nodata
          if (wp.manipulability >= 0.5) return MANIP_HIGH
          if (wp.manipulability >= 0.3) return MANIP_MED
          return MANIP_LOW
        case 'singularity':
          switch (wp.singularity_state) {
            case 'singular': return SINGULAR_SINGULAR
            case 'near': return SINGULAR_NEAR
            case 'normal': return SINGULAR_NORMAL
            default: return SEVERITY.nodata
          }
        default:
          return SEVERITY.nodata
      }
    })
  }, [colorMode, analysisWp, hasAnalysis, vis])

  const fallbackLine = useMemo(() => {
    if (!vis || vis.waypoints.length < 2) return null
    const pts = vis.waypoints.map((w: VisualWaypointDto) => new THREE.Vector3(...w.position))
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: TRAJECTORY_LINE }),
    )
  }, [vis])

  // Optimized trajectory (from /plan/optimize)
  const optimizedLine = useMemo(() => {
    if (!optimizedPositions || optimizedPositions.length < 2) return null
    const pts = optimizedPositions.map(p => new THREE.Vector3(p[0], p[1], p[2]))
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.8,
    })
    return <primitive object={new THREE.Line(geo, mat)} />
  }, [optimizedPositions])

  const optimizedMarkers = useMemo(() => {
    if (!optimizedPositions) return null
    const markerRadius = scaleFromRefDim(refDim, 0.015)
    return optimizedPositions.map((p, i) => (
      <mesh key={`opt-${i}`} position={[p[0], p[1], p[2]]}>
        <sphereGeometry args={[markerRadius, 8, 8]} />
        <meshBasicMaterial color={0x22c55e} transparent opacity={0.7} />
      </mesh>
    ))
  }, [optimizedPositions, refDim])

  // Preview trajectory (from /plan/commands/preview — PR3)
  const previewLine = useMemo(() => {
    if (!previewPositions || previewPositions.length < 2) return null
    const pts = previewPositions.map(p => new THREE.Vector3(p[0], p[1], p[2]))
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
    })
    return <primitive object={new THREE.Line(geo, mat)} />
  }, [previewPositions])

  const previewMarkers = useMemo(() => {
    if (!previewPositions) return null
    const markerRadius = scaleFromRefDim(refDim, 0.015)
    return previewPositions.map((p, i) => (
      <mesh key={`prev-${i}`} position={[p[0], p[1], p[2]]}>
        <sphereGeometry args={[markerRadius, 8, 8]} />
        <meshBasicMaterial color={0xf59e0b} transparent opacity={0.75} />
      </mesh>
    ))
  }, [previewPositions, refDim])

  // ── Mutually exclusive render ──
  if (trajectoryViewMode === 'preview' && previewPositions) {
    // Only show the previewed (simulated) trajectory
    if (previewPositions.length < 2) return null
    return (
      <group>
        {previewLine}
        {previewMarkers}
      </group>
    )
  }

  // ── Mutually exclusive render ──
  if (trajectoryViewMode === 'optimized' && optimizedPositions) {
    // Only show optimized trajectory
    if (optimizedPositions.length < 2) return null
    return (
      <group>
        {optimizedLine}
        {optimizedMarkers}
      </group>
    )
  }

  // Default: show original trajectory
  if (!vis || vis.waypoints.length < 2) return null

  return (
    <group>
      <TrajectoryLines
        waypoints={vis.waypoints} colorMode={colorMode}
        segments={segments ?? undefined} perWaypointColor={perWaypointColor}
        fallbackLine={fallbackLine}
      />
      <WaypointMarkers
        waypoints={vis.waypoints} colorMode={colorMode}
        segments={segments ?? undefined} perWaypointColor={perWaypointColor}
        activeIndex={activeWaypointIndex} refDim={refDim}
      />
    </group>
  )
}

function TrajectoryLines({
  waypoints, colorMode, segments, perWaypointColor, fallbackLine,
}: {
  waypoints: VisualWaypointDto[]
  colorMode: string
  segments?: { segmentIndex: number; waypointStart: number; waypointEnd: number }[]
  perWaypointColor: number[] | null
  fallbackLine: THREE.Line | null
}) {
  if (colorMode === 'segment' && segments && segments.length > 0) {
    return (
      <group>
        {segments.map((seg, segIdx) => {
          const wpSeg = waypoints.slice(seg.waypointStart, seg.waypointEnd + 1)
          if (wpSeg.length < 2) return null
          const pts = wpSeg.map(w => new THREE.Vector3(...w.position))
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: SEGMENT_PALETTE[segIdx % SEGMENT_PALETTE.length] }),
          )
          return <primitive key={segIdx} object={line} />
        })}
      </group>
    )
  }

  if (perWaypointColor && perWaypointColor.length === waypoints.length) {
    return <primitive object={buildColoredLine(waypoints, perWaypointColor)} />
  }

  if (!fallbackLine) return null
  return <primitive object={fallbackLine} />
}

function WaypointMarkers({
  waypoints, colorMode, segments, perWaypointColor, activeIndex, refDim,
}: {
  waypoints: VisualWaypointDto[]
  colorMode: string
  segments?: { segmentIndex: number; waypointStart: number; waypointEnd: number }[]
  perWaypointColor: number[] | null
  activeIndex: number
  /** Scene reference dimension — waypoint sphere radii scale with it. */
  refDim: number
}) {
  return (
    <group>
      {waypoints.map((wp, i) => {
        let color: number
        if (perWaypointColor?.[i] !== undefined) {
          color = perWaypointColor[i]
        } else if (colorMode === 'segment' && segments) {
          color = getSegmentColor(i, segments)
        } else {
          color = WAYPOINT_TYPE[wp.waypoint_type] ?? SEVERITY.nodata
        }
        const isActive = i === activeIndex
        // Trajectory LINES are NOT resized (they join the same world points) —
        // only the marker spheres scale with referenceDimension.
        const markerRadius = scaleFromRefDim(refDim, isActive ? 0.02 : 0.012)
        return (
          <mesh key={i} position={wp.position}>
            <sphereGeometry args={[markerRadius, isActive ? 16 : 12, 12]} />
            <meshBasicMaterial color={isActive ? WAYPOINT_ACTIVE : color} />
          </mesh>
        )
      })}
    </group>
  )
}

function buildColoredLine(waypoints: VisualWaypointDto[], colors: number[]): THREE.Line {
  const positions = new Float32Array(waypoints.length * 3)
  const colorArr = new Float32Array(waypoints.length * 3)
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i]; const c = new THREE.Color(colors[i] ?? SEVERITY.nodata)
    positions[i * 3] = wp.position[0]; positions[i * 3 + 1] = wp.position[1]; positions[i * 3 + 2] = wp.position[2]
    colorArr[i * 3] = c.r; colorArr[i * 3 + 1] = c.g; colorArr[i * 3 + 2] = c.b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3))
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
}

function getSegmentColor(i: number, segments: { segmentIndex: number; waypointStart: number; waypointEnd: number }[]): number {
  for (const seg of segments) {
    if (i >= seg.waypointStart && i <= seg.waypointEnd) {
      return SEGMENT_PALETTE[seg.segmentIndex % SEGMENT_PALETTE.length]
    }
  }
  return SEVERITY.nodata
}
