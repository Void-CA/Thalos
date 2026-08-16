import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import { minClearanceWaypoint } from '@/shared/contracts/analysis-report'
import {
  buildTrajectoryRuns,
  grid3DFrame,
  regionAtWaypoint,
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_END,
  TRAJECTORY_COLOR_MARKER,
  TRAJECTORY_COLOR_NEUTRAL,
  TRAJECTORY_COLOR_START,
  TRAJECTORY_COLOR_WARNING,
  type Grid3DFrame,
  type TrajectoryRun,
  type Vec3,
} from '@/shared/charts/trajectory3d'
import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'

/**
 * TrajectoryView — 3D trajectory chart for /evaluation (evaluation hotfix
 * CDD), migrated from echarts-gl to react-three-fiber + drei.
 *
 * The ChartModel contract is a frozen 2D contract (`'line' | 'bar' |
 * 'scatter'`), so the 3D trajectory can never flow through the normal
 * builder → adapter pipeline. Instead the view builds the scene straight from
 * the pure `trajectory3d.ts` model (buildTrajectoryRuns + grid3DFrame) inside
 * an R3F `<Canvas>`, following the viewport renderer patterns
 * (`scene-canvas.tsx`, `tcp-overlay.tsx`).
 *
 * The pure store→scene mapping lives in `buildTrajectoryScene` so the
 * coloring / run-grouping / selection-highlight rules stay unit-testable
 * without a DOM (same approach as the viewport overlay tests). Clicking a
 * waypoint maps it back to its covering problem region and selects it via the
 * analysis store, keeping chart and ProblemRegions/RegionInspector in sync.
 */

/** Region id covering `waypoint`, or null when clean — the click→store mapping. */
export function regionForWaypoint(regions: ProblemRegionWire[], waypoint: number): number | null {
  return regionAtWaypoint(regions, waypoint)?.id ?? null
}

export interface TrajectoryScene {
  runs: TrajectoryRun[]
  start?: Vec3
  end?: Vec3
  /** Minimum-clearance waypoint position, when the report metrics carry it. */
  marker?: Vec3
  /** Selected region id — matching runs render highlighted. */
  selectedRegionId: number | null
  frame: Grid3DFrame
}

/** Pure store→R3F scene mapping: severity runs, endpoints, clearance marker,
 *  grid frame and the selected-region highlight. Safe to unit test. */
export function buildTrajectoryScene(
  waypoints: Vec3[],
  regions: ProblemRegionWire[],
  selectedRegionId: number | null,
  markerWaypoint?: number | null,
): TrajectoryScene {
  const runs = buildTrajectoryRuns(waypoints, regions)
  const frame = grid3DFrame(waypoints)
  const markerInRange =
    markerWaypoint != null && markerWaypoint >= 0 && markerWaypoint < waypoints.length
  return {
    runs,
    ...(waypoints.length >= 2
      ? { start: waypoints[0], end: waypoints[waypoints.length - 1] }
      : {}),
    ...(markerInRange && markerWaypoint != null ? { marker: waypoints[markerWaypoint] } : {}),
    selectedRegionId,
    frame,
  }
}

/** A run's effective color: highlighted white + thicker when its region is the
 *  selected one; otherwise its severity color. */
function runColor(run: TrajectoryRun, scene: TrajectoryScene): string {
  return run.regionId !== null && run.regionId === scene.selectedRegionId ? '#ffffff' : run.color
}

/** Camera framing for a trajectory: position + target derived from the scene
 *  frame so the whole path always fills the view regardless of its units or
 *  scale (fixes the "chart renders tiny" gap the old hardcoded camera left).
 *  Pure — unit testable. The camera is placed along a fixed viewing direction
 *  at `distance` from the frame center, looking back at it. */
export function cameraForFrame(frame: Grid3DFrame): {
  position: [number, number, number]
  target: [number, number, number]
  distance: number
} {
  const span = Math.max(frame.span.x, frame.span.y, frame.span.z)
  const distance = span * 1.9 || 4
  // Viewing direction (normalized) with up ≈ +Z: gives a readable 3D angle
  // on a Z-up trajectory and never looks straight down the path.
  const view: [number, number, number] = [0.65, -0.78, 0.6]
  const len = Math.hypot(view[0], view[1], view[2]) || 1
  const position: [number, number, number] = [
    frame.center.x + (view[0] / len) * distance,
    frame.center.y + (view[1] / len) * distance,
    frame.center.z + (view[2] / len) * distance,
  ]
  return { position, target: [frame.center.x, frame.center.y, frame.center.z], distance }
}

/** Fits the R3F camera to the scene frame on mount (and once more when the
 *  frame changes, e.g. a different session loads). OrbitControls refreshes its
 *  target from the same ref so damping orbits around the trajectory center. */
function CameraRig({ frame }: { frame: Grid3DFrame }) {
  const camera = useThree((s) => s.camera)
  const controls = useRef<ComponentRef<typeof OrbitControls> | null>(null)
  const framing = useMemo(() => cameraForFrame(frame), [frame])

  useEffect(() => {
    if (typeof camera?.position?.set !== 'function') {
      // jsdom test harness has no real R3F camera — best effort only.
      return
    }
    camera.position.set(framing.position[0], framing.position[1], framing.position[2])
    camera.up.set(0, 0, 1)
    camera.lookAt(framing.target[0], framing.target[1], framing.target[2])
    camera.near = framing.distance / 100
    camera.far = framing.distance * 100
    camera.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(framing.target[0], framing.target[1], framing.target[2])
    }
  }, [camera, framing])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.15}
      minDistance={framing.distance * 0.1}
      maxDistance={framing.distance * 8}
    />
  )
}

/** Subtle reference grid floor under the trajectory (Z-up: plane at the frame
 *  min-z, spanning the padded frame). Gives the eye a scale/depth anchor so a
 *  flat-z SCARA path still reads as 3D. */
function GroundGrid({ frame }: { frame: Grid3DFrame }) {
  const size = Math.max(frame.span.x, frame.span.y, frame.span.z) || 1
  const divisions = 16
  return (
    <gridHelper
      args={[size * 1.6, divisions, '#3a3f4b', '#2a2e38']}
      position={[frame.center.x, frame.center.y, frame.min.z]}
      rotation={[0, 0, Math.PI / 2]}
    />
  )
}

function TrajectoryRuns({ scene, onSelect }: { scene: TrajectoryScene; onSelect: (waypoint: number) => void }) {
  const { runs } = scene
  return (
    <>
      {runs.map((run, i) => (
        <Line
          key={`run-${run.waypointStart}-${i}`}
          data-testid={`trajectory-run-${i}`}
          points={run.points.map((p) => [p.x, p.y, p.z])}
          color={runColor(run, scene)}
          lineWidth={run.regionId !== null && run.regionId === scene.selectedRegionId ? 5 : run.severity === 'clean' ? 2 : 3.5}
          onPointerDown={(e: { stopPropagation: () => void }) => {
            e.stopPropagation()
            onSelect(run.waypointStart)
          }}
        />
      ))}
    </>
  )
}

function WaypointMarkers({
  waypoints,
  regions,
  selectedRegionId,
  radius,
  onSelect,
}: {
  waypoints: Vec3[]
  regions: ProblemRegionWire[]
  selectedRegionId: number | null
  radius: number
  onSelect: (waypoint: number) => void
}) {
  return (
    <>
      {waypoints.map((p, i) => {
        const selected = regionForWaypoint(regions, i) !== null && regionForWaypoint(regions, i) === selectedRegionId
        return (
          <mesh
            key={`waypoint-${i}`}
            data-testid={`trajectory-waypoint-${i}`}
            position={[p.x, p.y, p.z]}
            onPointerDown={(e: { stopPropagation: () => void }) => {
              e.stopPropagation()
              onSelect(i)
            }}
          >
            <sphereGeometry args={[radius, 10, 10]} />
            <meshStandardMaterial color={selected ? '#ffffff' : TRAJECTORY_COLOR_NEUTRAL} roughness={0.6} />
          </mesh>
        )
      })}
    </>
  )
}

/** Start / End / min-clearance endpoint markers on top of the run lines. */
function EndpointMarkers({ scene, radius }: { scene: TrajectoryScene; radius: number }) {
  return (
    <>
      {scene.start ? (
        <mesh data-testid="trajectory-start" position={[scene.start.x, scene.start.y, scene.start.z]}>
          <sphereGeometry args={[radius, 12, 12]} />
          <meshStandardMaterial color={TRAJECTORY_COLOR_START} roughness={0.5} />
        </mesh>
      ) : null}
      {scene.end ? (
        <mesh data-testid="trajectory-end" position={[scene.end.x, scene.end.y, scene.end.z]}>
          <sphereGeometry args={[radius, 12, 12]} />
          <meshStandardMaterial color={TRAJECTORY_COLOR_END} roughness={0.5} />
        </mesh>
      ) : null}
      {scene.marker ? (
        <mesh data-testid="trajectory-clearance-marker" position={[scene.marker.x, scene.marker.y, scene.marker.z]}>
          <sphereGeometry args={[radius, 12, 12]} />
          <meshStandardMaterial color={TRAJECTORY_COLOR_MARKER} roughness={0.5} />
        </mesh>
      ) : null}
    </>
  )
}

export function TrajectoryView() {
  const waypoints = useSceneStore((s) => s.activePlan?.visualization?.waypoints)
  const report = useAnalysisStore((s) => s.report)
  const selectedRegionId = useAnalysisStore((s) => s.selectedRegionId)
  const selectRegion = useAnalysisStore((s) => s.selectRegion)

  const points = useMemo<Vec3[]>(
    () => (waypoints ?? []).map((w) => ({ x: w.position[0], y: w.position[1], z: w.position[2] })),
    [waypoints],
  )
  const regions = useMemo(() => report?.problem_regions ?? [], [report])
  const markerWaypoint = useMemo(() => (report ? minClearanceWaypoint(report.metrics) : null), [report])

  const scene = useMemo(
    () => buildTrajectoryScene(points, regions, selectedRegionId, markerWaypoint),
    [points, regions, selectedRegionId, markerWaypoint],
  )

  const onSelect = useMemo(() => (waypoint: number) => selectRegion(regionForWaypoint(regions, waypoint)), [regions, selectRegion])

  if (points.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 rounded-lg border border-border bg-card/50">
        No trajectory data to display.
      </div>
    )
  }

  const markerRadius = Math.max(scene.frame.span.x, scene.frame.span.y, scene.frame.span.z) * 0.015 || 0.02

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Trajectory
        </span>
        <span className="text-[10px] text-muted-foreground">drag to orbit · scroll to zoom</span>
      </div>
      <div data-testid="trajectory-chart" role="img" aria-label="Trajectory with problem regions" className="h-80 w-full">
        <Canvas dpr={[1, 2]} gl={{ antialias: true }} style={{ background: 'transparent' }}>
          <ambientLight intensity={0.55} />
          <directionalLight position={[0.6, -0.8, 1]} intensity={1.2} castShadow />
          <directionalLight position={[-1, 0.6, 0.4]} intensity={0.35} />
          <CameraRig frame={scene.frame} />
          <GroundGrid frame={scene.frame} />
          <TrajectoryRuns scene={scene} onSelect={onSelect} />
          <WaypointMarkers waypoints={points} regions={regions} selectedRegionId={selectedRegionId} radius={markerRadius * 0.6} onSelect={onSelect} />
          <EndpointMarkers scene={scene} radius={markerRadius} />
          {selectedRegionId !== null && scene.runs.some((r) => r.regionId === selectedRegionId) ? (
            <Html center distanceFactor={10}>
              <div className="pointer-events-none select-none whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
                Region {selectedRegionId}
              </div>
            </Html>
          ) : null}
        </Canvas>
      </div>
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

