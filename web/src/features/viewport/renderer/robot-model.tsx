import { useRef, useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { DEFAULT_FRAME_STYLE } from '../types'
import type { SceneFrame, SceneLink, ScenePrimitive, PrimitiveGeometry } from '../types'

/**
 * RobotModel — renderiza frames, links y primitivas de la escena robótica
 * usando React Three Fiber.
 *
 * Se actualiza automáticamente cuando sceneStore.data cambia.
 */
export function RobotModel() {
  const data = useSceneStore(s => s.data)
  const groupRef = useRef<THREE.Group>(null)

  if (!data) return null

  return (
    <group ref={groupRef}>
      {/* Links (segmentos cilíndricos entre frames) */}
      {data.links.map(link => (
        <LinkComponent key={link.id} link={link} />
      ))}

      {/* Primitivas visuales */}
      {data.primitives.map(p => (
        <PrimitiveComponent key={p.id} primitive={p} />
      ))}

      {/* Frames (ejes de coordenadas) */}
      {data.frames.map(frame => (
        <FrameComponent key={frame.id} frame={frame} />
      ))}
    </group>
  )
}

// ── Link: cilindro entre dos puntos ──

interface LinkComponentProps {
  link: SceneLink
}

function LinkComponent({ link }: LinkComponentProps) {
  const mesh = useMemo(() => {
    const start = new THREE.Vector3(...link.start)
    const end = new THREE.Vector3(...link.end)
    const direction = new THREE.Vector3().subVectors(end, start)
    const length = direction.length()

    if (length < 0.001) return null

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    const up = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize())

    return { position: mid, quaternion: quat, length }
  }, [link.start, link.end])

  if (!mesh) return null

  return (
    <mesh position={mesh.position} quaternion={mesh.quaternion}>
      <cylinderGeometry args={[0.008, 0.008, mesh.length, 6]} />
      <meshStandardMaterial color="#4a7a9a" />
    </mesh>
  )
}

// ── Frame: ejes de coordenadas ──

interface FrameComponentProps {
  frame: SceneFrame
}

function FrameComponent({ frame }: FrameComponentProps) {
  const style = frame.style ?? DEFAULT_FRAME_STYLE

  const pos = new THREE.Vector3(...frame.translation)
  const quat = new THREE.Quaternion(...frame.rotation)

  return (
    <group position={pos} quaternion={quat}>
      {/* X - Rojo */}
      <mesh position={[style.axisLength / 2, 0, 0]}>
        <cylinderGeometry args={[style.axisRadius, style.axisRadius, style.axisLength, 6]} />
        <meshStandardMaterial color={new THREE.Color(...style.colorX)} />
      </mesh>
      {/* Y - Verde */}
      <mesh position={[0, style.axisLength / 2, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[style.axisRadius, style.axisRadius, style.axisLength, 6]} />
        <meshStandardMaterial color={new THREE.Color(...style.colorY)} />
      </mesh>
      {/* Z - Azul */}
      <mesh position={[0, 0, style.axisLength / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[style.axisRadius, style.axisRadius, style.axisLength, 6]} />
        <meshStandardMaterial color={new THREE.Color(...style.colorZ)} />
      </mesh>
    </group>
  )
}

// ── Primitive: box, sphere, cylinder ──

interface PrimitiveComponentProps {
  primitive: ScenePrimitive
}

function PrimitiveComponent({ primitive }: PrimitiveComponentProps) {
  const material = useMemo(() => {
    const c = primitive.color
    const color = c
      ? new THREE.Color(c[0], c[1], c[2])
      : new THREE.Color(0x888888)
    const opacity = c?.[3] ?? 1
    return new THREE.MeshStandardMaterial({
      color,
      opacity,
      transparent: opacity < 1,
      roughness: 0.6,
      metalness: 0.3,
    })
  }, [primitive.color])

  const geometry = useMemo(() => createGeometry(primitive.geometry), [primitive.geometry])
  const pos = new THREE.Vector3(...primitive.translation)
  const quat = new THREE.Quaternion(...primitive.rotation)

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={pos}
      quaternion={quat}
    />
  )
}

function createGeometry(geo: PrimitiveGeometry): THREE.BufferGeometry {
  switch (geo.type) {
    case 'box':
      return new THREE.BoxGeometry(geo.width, geo.height, geo.depth)
    case 'sphere':
      return new THREE.SphereGeometry(geo.radius, 24, 24)
    case 'cylinder':
      return new THREE.CylinderGeometry(geo.radius, geo.radius, geo.height, 24)
  }
}
