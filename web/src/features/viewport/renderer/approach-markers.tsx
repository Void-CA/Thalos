import type { PoseDef } from '@/shared/contracts'
import { scaleFromRefDim } from './scale'

/**
 * ApproachMarkers — semi-transparent overlay markers for the SCARA
 * approach/retreat transit height (phantom-parameter fix: the backend now
 * consumes `SceneContent.approach_height`; this makes it visually
 * demonstrable in the viewport).
 *
 * Renders TWO markers per entity (approach, retreat) at
 * `entityPosition + [0, 0, approachHeight]` plus a faint vertical line from
 * the entity top to the markers (visualizes the descent/approach). Always-on
 * (matches the always-on MVP input) and re-renders live when the store's
 * `approachHeight` changes — `SceneEntities` subscribes to the store and
 * passes the value down as a prop.
 */
export interface ApproachMarkerEntity {
  id: string
  kind: 'object' | 'location'
  /** Nudge-adjusted mesh position — markers must align with the mesh. */
  basePosition: PoseDef['position']
}

interface ApproachMarkersProps {
  entities: ApproachMarkerEntity[]
  /** Scene reference dimension — marker sizes scale with it (no-op at 1.0). */
  refDim: number
  /** SCARA approach/retreat transit height (metres) above each entity. */
  approachHeight: number
  /** Scaled entity size — the mesh top sits at `baseZ + entitySize / 2`. */
  entitySize: number
}

/** Approach marker color (~cyan, tailwind cyan-400). */
const APPROACH_COLOR = 0x22d3ee
/** Retreat marker color (~violet, tailwind violet-400). */
const RETREAT_COLOR = 0xa78bfa
/** Overlay opacity — markers stay subtle, they are overlays not decorations. */
const MARKER_OPACITY = 0.35
/** Marker sphere radius at referenceDimension = 1.0 — scaled by scaleFromRefDim. */
const MARKER_RADIUS = 0.02

export function ApproachMarkers({ entities, refDim, approachHeight, entitySize }: ApproachMarkersProps) {
  if (approachHeight <= 0 || entities.length === 0) return null
  const markerRadius = scaleFromRefDim(refDim, MARKER_RADIUS)

  return (
    <group data-testid="approach-markers">
      {entities.map(({ id, kind, basePosition }) => {
        const [x, y, baseZ] = basePosition
        const markerZ = baseZ + approachHeight
        const topZ = baseZ + entitySize / 2
        const lineColor = kind === 'object' ? APPROACH_COLOR : RETREAT_COLOR
        return (
          <group key={id}>
            <mesh data-testid={`approach-marker-${id}`} position={[x, y, markerZ]} frustumCulled={false}>
              <sphereGeometry args={[markerRadius, 12, 12]} />
              <meshBasicMaterial color={APPROACH_COLOR} transparent opacity={MARKER_OPACITY} />
            </mesh>
            <mesh data-testid={`retreat-marker-${id}`} position={[x, y, markerZ]} frustumCulled={false}>
              <sphereGeometry args={[markerRadius, 12, 12]} />
              <meshBasicMaterial color={RETREAT_COLOR} transparent opacity={MARKER_OPACITY} />
            </mesh>
            <line data-testid={`approach-line-${id}`}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[new Float32Array([x, y, topZ, x, y, markerZ]), 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={lineColor} transparent opacity={MARKER_OPACITY} depthWrite={false} />
            </line>
          </group>
        )
      })}
    </group>
  )
}
