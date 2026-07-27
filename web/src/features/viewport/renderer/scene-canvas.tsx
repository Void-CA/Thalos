import { Suspense, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, AdaptiveDpr, Stats } from '@react-three/drei'
import { RobotModel } from './robot-model'
import { Trajectory } from './trajectory'
import { IkGizmo } from './ik-gizmo'
import { TcpOverlay } from './tcp-overlay'
import { PointCloud } from './point-cloud'
import { useSceneStore } from '../store'

interface SceneCanvasProps {
  showStats?: boolean
}

/**
 * Z-up Camera Controller — configura cámara con up=(0,0,1)
 * para convención robótica (plano XY horizontal).
 */
function CameraSetup() {
  const { camera } = useThree()
  const initialized = useRef(false)

  if (!initialized.current) {
    camera.up.set(0, 0, 1)
    camera.position.set(2, -3, 2)
    camera.lookAt(0, 0, 0)
    initialized.current = true
  }

  return null
}

/** GridHelper rotado π/2 en X para Z-up. */
function SceneGrid() {
  const refDim = useSceneStore(s => s.data?.referenceDimension) ?? 1.0
  const size = Math.max(refDim * 4, 0.5)

  return (
    <gridHelper
      args={[size, 10, 0x666666, 0x444444]}
      rotation={[Math.PI / 2, 0, 0]}
    />
  )
}

function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 5, 3]} intensity={1.0} />
    </>
  )
}

/** Contenedor R3F con Z-up, controles, robot y overlays. */
export function SceneCanvas({ showStats = false }: SceneCanvasProps) {
  const sceneData = useSceneStore(s => s.data)

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={[0x1a1a1a]} />
      <AdaptiveDpr pixelated />

      <CameraSetup />
      <SceneLights />
      <SceneGrid />

      {/* Ejes globales */}
      <axesHelper args={[0.5]} />

      {/* Robot + overlays */}
      {sceneData && (
        <Suspense fallback={null}>
          <RobotModel />
          <Trajectory />
          <IkGizmo />
          <TcpOverlay />
          <PointCloud />
        </Suspense>
      )}

      <OrbitControls
        enableDamping
        dampingFactor={0.15}
        minDistance={0.1}
        maxDistance={50}
      />

      {showStats && <Stats />}
    </Canvas>
  )
}
