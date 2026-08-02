import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { DEFAULT_FRAME_STYLE } from '../types'
import type { SceneFrame, SceneLink, ScenePrimitive } from '../types'
import { AXIS_ORIGIN, LINK_COLOR, LINK_OPACITY } from '@/shared/tokens'

/**
 * RobotModel — renders the robot scene and applies the single
 * `transformSnapshot` source of truth every frame.
 *
 * The component holds NO kinematic-family logic: it never computes FK, never
 * asks which robot is loaded, and never hardcodes frame ids. It only applies
 * the transforms it receives from `useSceneStore.transformSnapshot`:
 * - `execution`: object transforms from runtime ticks (frames + links)
 * - `fk`: frame transforms from backend `scene.frames` (POST /scene/joints)
 * - `idle`: leave the last applied state (static scene)
 *
 * Frame/link registries are per-instance refs instead of module-level maps, so
 * separate mounts never share stale entries.
 */
export function RobotModel() {
  const data = useSceneStore(s => s.data)
  const transformSnapshot = useSceneStore(s => s.transformSnapshot)
  const frameGroups = useRef(new Map<string, THREE.Group>())
  const linkMeshes = useRef(new Map<string, THREE.Mesh>())

  const primitivesByFrame = useMemo(() => {
    const m = new Map<string, ScenePrimitive[]>()
    for (const p of data?.primitives ?? []) {
      const list = m.get(p.frameId) ?? []; list.push(p); m.set(p.frameId, list)
    }
    return m
  }, [data?.primitives])

  const frameIds = useMemo(() => new Set((data?.frames ?? []).map(f => f.id)), [data?.frames])

  // Per-frame: apply the current transform snapshot to frame groups + link meshes.
  useFrame(() => {
    if (!data) return
    if (transformSnapshot.kind === 'execution') {
      for (const tx of transformSnapshot.transforms) {
        // Frame transforms (frame groups keyed by frame id)
        const g = frameGroups.current.get(tx.id)
        if (g) {
          g.position.set(tx.translation[0], tx.translation[1], tx.translation[2])
          g.quaternion.set(tx.rotation[1], tx.rotation[2], tx.rotation[3], tx.rotation[0])
          continue
        }
        // Link transforms (link meshes keyed by link id) — scale encodes cylinder length
        const m = linkMeshes.current.get(tx.id)
        if (m) {
          m.position.set(tx.translation[0], tx.translation[1], tx.translation[2])
          m.quaternion.set(tx.rotation[1], tx.rotation[2], tx.rotation[3], tx.rotation[0])
          m.scale.set(tx.scale[0], tx.scale[1], tx.scale[2])
        }
      }
      return
    }
    if (transformSnapshot.kind === 'fk') {
      for (const [id, frame] of transformSnapshot.frames) {
        const g = frameGroups.current.get(id)
        if (!g) continue
        g.position.set(frame.pos[0], frame.pos[1], frame.pos[2])
        g.quaternion.set(frame.quat[1], frame.quat[2], frame.quat[3], frame.quat[0])
      }
    }
    // kind === 'idle': nothing to apply (keep last state)
  })

  if (!data) return null

  return (
    <group>
      {data.links.map(link => <LinkComponent key={link.id} link={link} refDim={data.referenceDimension} registry={linkMeshes.current} />)}
      {data.frames.map(frame => (
        <FrameComponent key={frame.id} frame={frame} registry={frameGroups.current}>
          {primitivesByFrame.get(frame.id)?.map(p => <PrimitiveComponent key={p.id} primitive={p} />)}
        </FrameComponent>
      ))}
      {data.primitives.filter(p => !frameIds.has(p.frameId)).map(p => <PrimitiveComponent key={p.id} primitive={p} />)}
    </group>
  )
}

function rustQuatToThree([w, x, y, z]: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w)
}

function FrameComponent({ frame, registry, children }: { frame: SceneFrame; registry: Map<string, THREE.Group>; children?: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null)
  // Safe style — FK endpoint may return frames without style field
  const style = { ...DEFAULT_FRAME_STYLE, ...(frame.style ?? {}) }

  // Register frame group for transform sync AND set initial position
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    registry.set(frame.id, g)
    // Set initial position (R3F won't reset it if we don't pass position as prop)
    g.position.set(frame.translation[0], frame.translation[1], frame.translation[2])
    const q = rustQuatToThree(frame.rotation)
    g.quaternion.set(q.x, q.y, q.z, q.w)
    return () => { registry.delete(frame.id) }
  }, [frame.id, frame.translation, frame.rotation, registry])

  return (
    <group ref={groupRef}>
      {style.originRadius > 0 && (<mesh><sphereGeometry args={[style.originRadius,12,12]} /><meshStandardMaterial color={AXIS_ORIGIN} /></mesh>)}
      <AxisArrow dir={new THREE.Vector3(1,0,0)} length={style.axisLength} radius={style.axisRadius} color={new THREE.Color(...style.colorX)} />
      <AxisArrow dir={new THREE.Vector3(0,1,0)} length={style.axisLength} radius={style.axisRadius} color={new THREE.Color(...style.colorY)} />
      <AxisArrow dir={new THREE.Vector3(0,0,1)} length={style.axisLength} radius={style.axisRadius} color={new THREE.Color(...style.colorZ)} />
      {children}
    </group>
  )
}

function LinkComponent({ link, refDim, registry }: { link: SceneLink; refDim: number; registry: Map<string, THREE.Mesh> }) {
  const radius = Math.max(refDim * 0.015, 0.003)
  const meshRef = useRef<THREE.Mesh>(null)
  const mesh = useMemo(() => {
    const start = new THREE.Vector3(...link.start); const end = new THREE.Vector3(...link.end)
    const dir = new THREE.Vector3().subVectors(end, start); const len = dir.length()
    if (len < 1e-10) return null
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    const up = new THREE.Vector3(0,1,0); const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize())
    return { position: mid, quaternion: q, length: len }
  }, [link.start, link.end])

  // Register mesh for runtime transform sync
  useEffect(() => {
    if (meshRef.current) registry.set(link.id, meshRef.current)
    return () => { registry.delete(link.id) }
  }, [link.id, registry])

  if (!mesh) return null
  return (<mesh ref={meshRef} position={mesh.position} quaternion={mesh.quaternion} scale={[1, mesh.length, 1]}>
    <cylinderGeometry args={[radius, radius, 1, 8, 1]} /><meshStandardMaterial color={LINK_COLOR} transparent opacity={LINK_OPACITY} />
  </mesh>)
}

function PrimitiveComponent({ primitive }: { primitive: ScenePrimitive }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => {
    switch (primitive.geometry.type) {
      case 'box': return new THREE.BoxGeometry(primitive.geometry.width, primitive.geometry.height, primitive.geometry.depth)
      case 'sphere': return new THREE.SphereGeometry(primitive.geometry.radius, 16, 16)
      case 'cylinder': return new THREE.CylinderGeometry(primitive.geometry.radius, primitive.geometry.radius, primitive.geometry.height, 16, 1)
    }
  }, [primitive.geometry])
  const color = primitive.color ? new THREE.Color(primitive.color[0], primitive.color[1], primitive.color[2]) : new THREE.Color(0xaaaaaa)
  const opacity = primitive.color?.[3] ?? 1

  return (
    <mesh ref={meshRef} geometry={geometry}
      position={new THREE.Vector3(...primitive.translation)}
      quaternion={rustQuatToThree(primitive.rotation)}
      frustumCulled={false}>
      <meshStandardMaterial color={color} opacity={opacity} transparent={opacity < 1} roughness={0.6} metalness={0.3} />
    </mesh>
  )
}

function AxisArrow({ dir, length, radius, color }: { dir: THREE.Vector3; length: number; radius: number; color: THREE.Color }) {
  if (radius > 1e-6) {
    const hl = Math.min(length * 0.2, 0.04), sl = length - hl, up = new THREE.Vector3(0,1,0)
    const sc = dir.clone().multiplyScalar(sl/2), hc = dir.clone().multiplyScalar(sl+hl/2)
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir)
    return (<group><mesh position={sc} quaternion={q}><cylinderGeometry args={[radius, radius, sl, 6, 1]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={hc} quaternion={q}><coneGeometry args={[radius*3, hl, 6, 1]} /><meshStandardMaterial color={color} /></mesh></group>)
  }
  return <primitive object={createAxisLine(dir, length, color)} />
}
function createAxisLine(d: THREE.Vector3, l: number, c: THREE.Color) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), d.clone().multiplyScalar(l)]), new THREE.LineBasicMaterial({ color: c }))
}
