import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, AdaptiveDpr, Stats } from '@react-three/drei'
import { RobotModel } from './robot-model'
import { useSceneStore } from '../store'

interface SceneCanvasProps {
  showStats?: boolean
  /** Callback cuando el canvas está listo. */
  onReady?: () => void
}

/** Contenedor R3F con controles de órbita y el modelo del robot. */
export function SceneCanvas({ showStats = false }: SceneCanvasProps) {
  const sceneData = useSceneStore(s => s.data)

  return (
    <Canvas
      camera={{ position: [2, 1.5, 2], fov: 45, near: 0.01, far: 100 }}
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={[0x1a1a1a]} />
      <AdaptiveDpr pixelated />

      {/* Iluminación */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 10, 5]} intensity={1} />
      <directionalLight position={[-5, -5, -5]} intensity={0.3} />

      {/* Grid */}
      <gridHelper args={[10, 10, 0x444444, 0x333333]} />

      {/* Modelo del robot */}
      {sceneData && (
        <Suspense fallback={null}>
          <RobotModel />
        </Suspense>
      )}

      {/* Ejes de referencia */}
      <axesHelper args={[0.5]} />

      {/* Controles */}
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
