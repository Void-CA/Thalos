import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { VisualWaypointDto } from '../api/scene-api.types'
import {
  SEGMENT_PALETTE,
  WAYPOINT_TYPE,
  TRAJECTORY_LINE,
  SEVERITY,
  MANIP_HIGH, MANIP_MED, MANIP_LOW,
  SINGULAR_NORMAL, SINGULAR_NEAR, SINGULAR_SINGULAR,
} from '@/shared/tokens'

/**
 * Trajectory — renderiza la trayectoria del plan activo.
 *
 * Muestra exclusivamente una de las dos según `trajectoryViewMode`:
 * - `original`  → trayectoria original coloreada por modo
 * - `optimized` → solo la trayectoria optimizada (verde sólido)
 *
 * Nunca ambas al mismo tiempo — toggle mutuamente excluyente.
 */
export function Trajectory() {
  const activePlan = useSceneStore(s => s.activePlan)
  const optimizedPositions = useSceneStore(s => s.optimizedPositions)
  const trajectoryViewMode = useSceneStore(s => s.trajectoryViewMode)
  const colorMode = useSceneStore(s => s.trajectoryColorMode)
  const analysisWp = useAnalysisStore(s => s.waypoints)
  const segments = activePlan?.segments
  const vis = activePlan?.visualization

  const hasAnalysis = analysisWp.length > 0 && analysisWp.length === (vis?.waypoints.length ?? 0)

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
    return optimizedPositions.map((p, i) => (
      <mesh key={`opt-${i}`} position={[p[0], p[1], p[2]]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshBasicMaterial color={0x22c55e} transparent opacity={0.7} />
      </mesh>
    ))
  }, [optimizedPositions])

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
  waypoints, colorMode, segments, perWaypointColor,
}: {
  waypoints: VisualWaypointDto[]
  colorMode: string
  segments?: { segmentIndex: number; waypointStart: number; waypointEnd: number }[]
  perWaypointColor: number[] | null
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
        return (
          <mesh key={i} position={wp.position}>
            <sphereGeometry args={[0.012, 12, 12]} />
            <meshBasicMaterial color={color} />
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
