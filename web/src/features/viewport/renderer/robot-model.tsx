import { useMemo } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../store'
import { DEFAULT_FRAME_STYLE } from '../types'
import type { SceneFrame, SceneLink, ScenePrimitive } from '../types'
import { AXIS_ORIGIN, LINK_COLOR, LINK_OPACITY } from '@/shared/tokens'

export function RobotModel() {
  const data = useSceneStore(s => s.data)
  if (!data) return null

  const primitivesByFrame = useMemo(() => {
    const map = new Map<string, ScenePrimitive[]>()
    for (const p of data.primitives) {
      const list = map.get(p.frameId) ?? []
      list.push(p)
      map.set(p.frameId, list)
    }
    return map
  }, [data.primitives])

  const frameIds = new Set(data.frames.map(f => f.id))

  return (
    <group>
      {data.links.map(link => (
        <LinkComponent key={link.id} link={link} refDim={data.referenceDimension} />
      ))}
      {data.frames.map(frame => (
        <FrameComponent key={frame.id} frame={frame}>
          {primitivesByFrame.get(frame.id)?.map(p => (
            <PrimitiveComponent key={p.id} primitive={p} />
          ))}
        </FrameComponent>
      ))}
      {data.primitives.filter(p => !frameIds.has(p.frameId)).map(p => (
        <PrimitiveComponent key={p.id} primitive={p} />
      ))}
    </group>
  )
}

interface FrameComponentProps { frame: SceneFrame; children?: React.ReactNode }
function rustQuatToThree([w, x, y, z]: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w)
}
function FrameComponent({ frame, children }: FrameComponentProps) {
  const style = frame.style ?? DEFAULT_FRAME_STYLE
  const pos = new THREE.Vector3(...frame.translation)
  const quat = rustQuatToThree(frame.rotation)
  return (
    <group position={pos} quaternion={quat}>
      {style.originRadius > 0 && (<mesh><sphereGeometry args={[style.originRadius, 12, 12]} /><meshStandardMaterial color={AXIS_ORIGIN} /></mesh>)}
      <AxisArrow dir={new THREE.Vector3(1,0,0)} length={style.axisLength} radius={style.axisRadius} color={new THREE.Color(...style.colorX)} />
      <AxisArrow dir={new THREE.Vector3(0,1,0)} length={style.axisLength} radius={style.axisRadius} color={new THREE.Color(...style.colorY)} />
      <AxisArrow dir={new THREE.Vector3(0,0,1)} length={style.axisLength} radius={style.axisRadius} color={new THREE.Color(...style.colorZ)} />
      {children}
    </group>
  )
}

interface LinkComponentProps { link: SceneLink; refDim: number }
function LinkComponent({ link, refDim }: LinkComponentProps) {
  const radius = Math.max(refDim * 0.015, 0.003)
  const mesh = useMemo(() => {
    const start = new THREE.Vector3(...link.start)
    const end = new THREE.Vector3(...link.end)
    const dir = new THREE.Vector3().subVectors(end, start)
    const length = dir.length()
    if (length < 1e-10) return null
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    const up = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize())
    return { position: mid, quaternion: quat, length }
  }, [link.start, link.end])
  if (!mesh) return null
  return (<mesh position={mesh.position} quaternion={mesh.quaternion} scale={[1, mesh.length, 1]}>
    <cylinderGeometry args={[radius, radius, 1, 8, 1]} /><meshStandardMaterial color={LINK_COLOR} transparent opacity={LINK_OPACITY} />
  </mesh>)
}

function PrimitiveComponent({ primitive }: { primitive: ScenePrimitive }) {
  const geometry = useMemo(() => {
    switch (primitive.geometry.type) {
      case 'box': return new THREE.BoxGeometry(primitive.geometry.width, primitive.geometry.height, primitive.geometry.depth)
      case 'sphere': return new THREE.SphereGeometry(primitive.geometry.radius, 16, 16)
      case 'cylinder': return new THREE.CylinderGeometry(primitive.geometry.radius, primitive.geometry.radius, primitive.geometry.height, 16, 1)
    }
  }, [primitive.geometry])
  const color = primitive.color ? new THREE.Color(primitive.color[0], primitive.color[1], primitive.color[2]) : new THREE.Color(0xaaaaaa)
  const opacity = primitive.color?.[3] ?? 1
  const pos = new THREE.Vector3(...primitive.translation)
  const quat = rustQuatToThree(primitive.rotation)
  return (<mesh geometry={geometry} position={pos} quaternion={quat} frustumCulled={false}>
    <meshStandardMaterial color={color} opacity={opacity} transparent={opacity < 1} roughness={0.6} metalness={0.3} />
  </mesh>)
}

function AxisArrow({ dir, length, radius, color }: { dir: THREE.Vector3; length: number; radius: number; color: THREE.Color }) {
  if (radius > 1e-6) {
    const headLen = Math.min(length * 0.2, 0.04); const shaftLen = length - headLen; const up = new THREE.Vector3(0, 1, 0)
    const shaftCenter = dir.clone().multiplyScalar(shaftLen / 2); const headCenter = dir.clone().multiplyScalar(shaftLen + headLen / 2)
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)
    return (<group><mesh position={shaftCenter} quaternion={quat}><cylinderGeometry args={[radius, radius, shaftLen, 6, 1]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={headCenter} quaternion={quat}><coneGeometry args={[radius * 3, headLen, 6, 1]} /><meshStandardMaterial color={color} /></mesh></group>)
  }
  return <primitive object={createAxisLine(dir, length, color)} />
}
function createAxisLine(dir: THREE.Vector3, length: number, color: THREE.Color): THREE.Line {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), dir.clone().multiplyScalar(length)]), new THREE.LineBasicMaterial({ color }))
}
