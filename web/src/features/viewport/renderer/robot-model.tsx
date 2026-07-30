import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { DEFAULT_FRAME_STYLE } from '../types'
import type { SceneFrame, SceneLink, ScenePrimitive } from '../types'
import { AXIS_ORIGIN, LINK_COLOR, LINK_OPACITY } from '@/shared/tokens'

/** Angular-style registries for runtime transform sync */
const frameGroups = new Map<string, THREE.Group>()
/** Link mesh registry — actualizado desde RuntimeDelta.transforms en Path A */
const linkMeshes = new Map<string, THREE.Mesh>()
let prevJoints: number[] = []

// SCARA canonical FK parameters
const A1 = 1.0, A2 = 0.8, BASE_Z = 0.5

/** Compute frame world positions from SCARA joint angles. Returns map of frameId → {pos, quat}. */
function scaraFrames(joints: number[]) {
  const j1 = joints[0] ?? 0, j2 = joints[1] ?? 0, j3 = joints[2] ?? 0
  const c1 = Math.cos(j1), s1 = Math.sin(j1)
  const c12 = Math.cos(j1 + j2), s12 = Math.sin(j1 + j2)
  const l1x = A1 * c1, l1y = A1 * s1
  const l2x = l1x + A2 * c12, l2y = l1y + A2 * s12
  const l2z = BASE_Z + j3

  return {
    world:        { t: [0, 0, 0],       r: [1,0,0,0] },
    base:         { t: [0, 0, BASE_Z],  r: [1,0,0,0] },
    link_1:       { t: [l1x, l1y, BASE_Z], r: [Math.cos(j1/2),0,0,Math.sin(j1/2)] },
    link_2:       { t: [l2x, l2y, BASE_Z], r: [Math.cos((j1+j2)/2),0,0,Math.sin((j1+j2)/2)] },
    prismatic_joint: { t: [l2x, l2y, l2z], r: [1,0,0,0] },
    wrist:        { t: [l2x, l2y, l2z], r: [Math.cos((j1+j2)/2),0,0,Math.sin((j1+j2)/2)] },
  }
}

export function RobotModel() {
  const data = useSceneStore(s => s.data)
  const runtime = useSceneStore(s => s.runtime)
  const liveTransforms = useSceneStore(s => s.liveTransforms)
  if (!data) return null

  // Per-frame: sync frame groups + link meshes from liveTransforms (scene tick) or FK (local playback)
  useFrame(() => {
    // Path A: scene tick → liveTransforms has frame + link transforms
    if (liveTransforms.length > 0) {
      for (const tx of liveTransforms) {
        // Apply frame transforms (frameGroups)
        const g = frameGroups.get(tx.id)
        if (g) {
          g.position.set(tx.translation[0], tx.translation[1], tx.translation[2])
          g.quaternion.set(tx.rotation[1], tx.rotation[2], tx.rotation[3], tx.rotation[0])
          continue
        }
        // Apply link transforms (linkMeshes) — scale encodes cylinder length
        const m = linkMeshes.get(tx.id)
        if (m) {
          m.position.set(tx.translation[0], tx.translation[1], tx.translation[2])
          m.quaternion.set(tx.rotation[1], tx.rotation[2], tx.rotation[3], tx.rotation[0])
          m.scale.set(tx.scale[0], tx.scale[1], tx.scale[2])
        }
      }

      return
    }
    // Path B: local playback from runtime.joints
    const joints = runtime?.joints
    if (!joints || joints.length < 3) return
    if (joints.every((v, i) => v === prevJoints[i])) return
    prevJoints = [...joints]
    const frames = scaraFrames(joints)
    for (const [id, f] of Object.entries(frames)) {
      const g = frameGroups.get(id); if (!g) continue
      g.position.set(f.t[0], f.t[1], f.t[2])
      g.quaternion.set(f.r[1], f.r[2], f.r[3], f.r[0])
    }
  })

  const primitivesByFrame = useMemo(() => {
    const m = new Map<string, ScenePrimitive[]>()
    for (const p of data.primitives) {
      const list = m.get(p.frameId) ?? []; list.push(p); m.set(p.frameId, list)
    }
    return m
  }, [data.primitives])

  const frameIds = new Set(data.frames.map(f => f.id))

  return (
    <group>
      {data.links.map(link => <LinkComponent key={link.id} link={link} refDim={data.referenceDimension} />)}
      {data.frames.map(frame => (
        <FrameComponent key={frame.id} frame={frame}>
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

function FrameComponent({ frame, children }: { frame: SceneFrame; children?: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null)
  // Safe style — FK endpoint may return frames without style field
  const style = { ...DEFAULT_FRAME_STYLE, ...(frame.style ?? {}) }

  // Register frame group for syncTransforms AND set initial position
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    frameGroups.set(frame.id, g)
    // Set initial position (R3F won't reset it if we don't pass position as prop)
    g.position.set(frame.translation[0], frame.translation[1], frame.translation[2])
    const q = rustQuatToThree(frame.rotation)
    g.quaternion.set(q.x, q.y, q.z, q.w)
    return () => { frameGroups.delete(frame.id) }
  }, [frame.id, frame.translation, frame.rotation])

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

function LinkComponent({ link, refDim }: { link: SceneLink; refDim: number }) {
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

  // Register mesh for liveTransforms sync (Path A)
  useEffect(() => {
    if (meshRef.current) linkMeshes.set(link.id, meshRef.current)
    return () => { linkMeshes.delete(link.id) }
  }, [link.id])

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
