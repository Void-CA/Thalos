import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import type { VisualWaypointDto } from '../../viewport/api/scene-api.types'

const WAYPOINT_COLORS: Record<string, string> = {
  Start: '#22c55e',
  Goal: '#ef4444',
  Via: '#3b82f6',
}

/**
 * Trajectory — renderiza la trayectoria del plan activo como una línea
 * con marcadores de waypoint.
 */
export function Trajectory() {
  const activePlan = useSceneStore(s => s.activePlan)

  const vis = activePlan?.visualization
  if (!vis || vis.waypoints.length < 2) return null

  return (
    <group>
      <TrajectoryLine waypoints={vis.waypoints} />
      <WaypointMarkers waypoints={vis.waypoints} />
    </group>
  )
}

function TrajectoryLine({ waypoints }: { waypoints: VisualWaypointDto[] }) {
  const points = useMemo(() => {
    return waypoints.map(w => new THREE.Vector3(...w.position))
  }, [waypoints])

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    return geo
  }, [points])

  return (
    <line>
      <bufferGeometry {...geometry} />
      <lineBasicMaterial color="#3b82f6" linewidth={2} />
    </line>
  )
}

function WaypointMarkers({ waypoints }: { waypoints: VisualWaypointDto[] }) {
  return (
    <group>
      {waypoints.map((wp, i) => (
        <mesh key={i} position={wp.position}>
          <sphereGeometry args={[0.012, 12, 12]} />
          <meshStandardMaterial
            color={WAYPOINT_COLORS[wp.waypoint_type] ?? '#888888'}
          />
        </mesh>
      ))}
    </group>
  )
}
