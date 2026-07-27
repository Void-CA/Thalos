import { Suspense, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, AdaptiveDpr, Stats } from '@react-three/drei'
import { RobotModel } from './robot-model'
import { useSceneStore } from '../store'

interface SceneCanvasProps {
  showStats?: boolean
}

/**
 * Z-up Camera Controller
 *
 * Three.js defaults to Y-up. Thalos usa Z-up (convención robótica).
 * Este componente se monta dentro del Canvas y configura la cámara
 * con up = (0, 0, 1) para que el plano XY sea el ground horizontal.
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

/**
 * Grid Z-up — GridHelper rotado 90° en X para que quede en el plano XY
 * en vez del XZ default de Three.js.
 *
 * El tamaño se ajusta dinámicamente según referenceDimension del robot.
 */
function Grid() {
  const refDim = useSceneStore(s => s.data?.referenceDimension) ?? 1.0
  const size = Math.max(refDim * 4, 0.5)
  const divs = 10

  return (
    <gridHelper
      args={[size, divs, 0x666666, 0x444444]}
      rotation={[Math.PI / 2, 0, 0]}
    />
  )
}

/** Luz ambiental + direccional siguiendo la convención Angular. */
function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 5, 3]} intensity={1.0} />
    </>
  )
}

/** Contenedor R3F con Z-up, controles de órbita y modelo del robot. */
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

      {/* Z-up: reconfigura cámara antes de OrbitControls */}
      <CameraSetup />

      {/* Iluminación (coincide con Angular: ambient 0.5 + directional (2,5,3) 1.0) */}
      <SceneLights />

      {/* Grid rotado para Z-up (plano XY horizontal) */}
      <Grid />

      {/* Ejes de referencia (globales) */}
      <axesHelper args={[0.5]} />

      {/* Modelo del robot */}
      {sceneData && (
        <Suspense fallback={null}>
          <RobotModel />
        </Suspense>
      )}

      {/* Controles con damping — respetan camera.up (Z-up) */}
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
