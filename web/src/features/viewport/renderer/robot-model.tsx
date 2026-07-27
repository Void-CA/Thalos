import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { DEFAULT_FRAME_STYLE } from '../types'
import type { SceneFrame, SceneLink, ScenePrimitive, PrimitiveGeometry } from '../types'

/**
 * RobotModel — renderiza frames, links y primitivas de la escena robótica.
 *
 * Convenciones Thalos (Z-up):
 *   - Three.js CylinderGeometry es Y-aligned → se rota según dirección.
 *   - Quaternions desde Rust: [w, x, y, z] → Three.js: .set(x, y, z, w).
 *   - Grid en plano XY (Z-up horizontal), gridHelper rotado π/2 en X.
 *
 * Matching exacto del renderer Angular (three-renderer.service.ts):
 *   - Links: Cylinder #3399ff, opacity 0.35, 8 radial segments.
 *   - Frames: shaft (cylinder) + head (cone) por eje, colores X=1,0.5,0 | Y=0,0.8,0 | Z=0,0.5,1.
 *   - Primitivas anidadas bajo su frame padre.
 */
export function RobotModel() {
  const data = useSceneStore(s => s.data)
  const groupRef = useRef<THREE.Group>(null)

  if (!data) return null

  return (
    <group ref={groupRef}>
      {/* Links primero (detrás de todo) */}
      {data.links.map(link => (
        <LinkComponent key={link.id} link={link} refDim={data.referenceDimension} />
      ))}

      {/* Primitivas visuales */}
      {data.primitives.map(p => (
        <PrimitiveComponent key={p.id} primitive={p} />
      ))}

      {/* Frames de coordenadas encima de todo */}
      {data.frames.map(frame => (
        <FrameComponent key={frame.id} frame={frame} />
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════
//  Link — cilindro entre dos articulaciones
// ═══════════════════════════════════════════

interface LinkComponentProps {
  link: SceneLink
  refDim: number
}

function LinkComponent({ link, refDim }: LinkComponentProps) {
  const radius = Math.max(refDim * 0.015, 0.003)

  const mesh = useMemo(() => {
    const start = new THREE.Vector3(...link.start)
    const end = new THREE.Vector3(...link.end)
    const dir = new THREE.Vector3().subVectors(end, start)
    const length = dir.length()

    if (length < 1e-10) return null

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    const up = new THREE.Vector3(0, 1, 0) // CylinderGeometry es Y-aligned
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize())

    return { position: mid, quaternion: quat, scale: [1, length, 1] as const }
  }, [link.start, link.end])

  if (!mesh) return null

  return (
    <mesh position={mesh.position} quaternion={mesh.quaternion} scale={mesh.scale}>
      {/* Unit cylinder along +Y, scaled Y to actual length — matching Angular */}
      <cylinderGeometry args={[radius, radius, 1, 8, 1]} />
      {/* #3399ff con 0.35 opacity — matching Angular */}
      <meshStandardMaterial
        color="#3399ff"
        transparent
        opacity={0.35}
      />
    </mesh>
  )
}

// ═══════════════════════════════════════════
//  Frame — ejes de coordenadas X(rojo/anaranjado) Y(verde) Z(azul)
// ═══════════════════════════════════════════

interface FrameComponentProps {
  frame: SceneFrame
}

/** Convierte quaternion Rust [w, x, y, z] → Three.js (x, y, z, w). */
function rustQuatToThree([w, x, y, z]: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w)
}

/** Construye una flecha de eje: shaft cilíndrico + cono en la punta. */
function AxisArrow({
  dir,
  length,
  radius,
  color,
}: {
  dir: THREE.Vector3
  length: number
  radius: number
  color: THREE.Color
}) {
  const headLen = Math.min(length * 0.2, 0.04)
  const shaftLen = length - headLen
  const up = new THREE.Vector3(0, 1, 0)
  const shaftCenter = dir.clone().multiplyScalar(shaftLen / 2)
  const headCenter = dir.clone().multiplyScalar(shaftLen + headLen / 2)

  if (radius > 1e-6) {
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)

    return (
      <group>
        {/* Shaft */}
        <mesh position={shaftCenter} quaternion={quat}>
          <cylinderGeometry args={[radius, radius, shaftLen, 6, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
        {/* Arrow head */}
        <mesh position={headCenter} quaternion={quat}>
          <coneGeometry args={[radius * 3, headLen, 6, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
    )
  }

  // Fallback: línea cuando radius ≈ 0
  const pts = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(length)]
  const geom = new THREE.BufferGeometry().setFromPoints(pts)

  return (
    <line geometry={geom}>
      <lineBasicMaterial color={color} />
    </line>
  )
}

function FrameComponent({ frame }: FrameComponentProps) {
  const style = frame.style ?? DEFAULT_FRAME_STYLE
  const pos = new THREE.Vector3(...frame.translation)
  // Rust quaternion [w, x, y, z] → Three.js (x, y, z, w)
  const quat = rustQuatToThree(frame.rotation)

  return (
    <group position={pos} quaternion={quat}>
      {/* Origin sphere — matching Angular: solo si originRadius > 0 */}
      {style.originRadius > 0 && (
        <mesh>
          <sphereGeometry args={[style.originRadius, 12, 12]} />
          <meshStandardMaterial color="#cccccc" />
        </mesh>
      )}

      {/* Ejes — matching Angular: X=1,0.5,0 | Y=0,0.8,0 | Z=0,0.5,1 */}
      <AxisArrow
        dir={new THREE.Vector3(1, 0, 0)}
        length={style.axisLength}
        radius={style.axisRadius}
        color={new THREE.Color(...style.colorX)}
      />
      <AxisArrow
        dir={new THREE.Vector3(0, 1, 0)}
        length={style.axisLength}
        radius={style.axisRadius}
        color={new THREE.Color(...style.colorY)}
      />
      <AxisArrow
        dir={new THREE.Vector3(0, 0, 1)}
        length={style.axisLength}
        radius={style.axisRadius}
        color={new THREE.Color(...style.colorZ)}
      />
    </group>
  )
}

// ═══════════════════════════════════════════
//  Primitive — geometría URDF (box, sphere, cylinder)
// ═══════════════════════════════════════════

// TODO: parentear primitivas al grupo del frame padre requiere un registry
// de refs compartido entre FrameComponent y PrimitiveComponent.
// Por ahora se renderizan en world space (translación + rotación absolutos).

function createPrimitiveGeometry(geo: PrimitiveGeometry): THREE.BufferGeometry {
  switch (geo.type) {
    case 'box':
      return new THREE.BoxGeometry(geo.width, geo.height, geo.depth)
    case 'sphere':
      return new THREE.SphereGeometry(geo.radius, 16, 16)
    case 'cylinder':
      return new THREE.CylinderGeometry(geo.radius, geo.radius, geo.height, 16, 1)
  }
}

function PrimitiveComponent({ primitive }: PrimitiveComponentProps) {
  const geometry = useMemo(() => createPrimitiveGeometry(primitive.geometry), [primitive.geometry])
  const parentGroup = useFrameGroup(primitive.frameId)

  const color = primitive.color
    ? new THREE.Color(primitive.color[0], primitive.color[1], primitive.color[2])
    : new THREE.Color(0xaaaaaa)

  const opacity = primitive.color?.[3] ?? 1

  // Rust quaternion [w, x, y, z] → Three.js (x, y, z, w)
  const pos = new THREE.Vector3(...primitive.translation)
  const quat = rustQuatToThree(primitive.rotation)

  return (
    <mesh
      geometry={geometry}
      position={pos}
      quaternion={quat}
    >
      <meshStandardMaterial
        color={color}
        opacity={opacity}
        transparent={opacity < 1}
        roughness={0.6}
        metalness={0.3}
      />
    </mesh>
  )
}
