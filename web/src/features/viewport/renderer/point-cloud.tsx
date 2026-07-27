import { useMemo } from 'react'
import * as THREE from 'three'
import { useWorkspaceStore, type CloudPoint } from '../store/workspace-store'

/**
 * PointCloud — nube de puntos del workspace con THREE.Points.
 *
 * Los samples se toman del set correspondiente al colorMode activo:
 *   - workspace:      workspaceSamples (position only) → naranja sólido
 *   - singularity:    singularitySamples (position + state) → verde/ámbar/rojo
 *   - manipulability: manipulabilitySamples (position + yoshikawa) → gradiente
 *   - none:           no se renderiza
 */
export function PointCloud() {
  const colorMode = useWorkspaceStore(s => s.colorMode)
  const visible = useWorkspaceStore(s => s.showPointCloud)
  const ws = useWorkspaceStore(s => s.workspaceSamples)
  const sg = useWorkspaceStore(s => s.singularitySamples)
  const mp = useWorkspaceStore(s => s.manipulabilitySamples)

  const points = colorMode === 'workspace' ? ws
    : colorMode === 'singularity' ? sg
    : colorMode === 'manipulability' ? mp
    : null

  const buffer = useMemo(() => {
    if (!points || points.length === 0 || colorMode === 'none') return null

    const positions = new Float32Array(points.length * 3)
    const colors = new Float32Array(points.length * 3)

    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      positions[i * 3] = p.position[0]
      positions[i * 3 + 1] = p.position[1]
      positions[i * 3 + 2] = p.position[2]

      const c = pickColor(p, colorMode)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [points, colorMode])

  if (!buffer || !visible) return null

  return (
    <points geometry={buffer}>
      <pointsMaterial
        size={0.015}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.7}
        depthTest
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function pickColor(p: CloudPoint, mode: string): THREE.Color {
  if (mode === 'workspace') {
    return new THREE.Color(0xff8800)
  }
  if (mode === 'singularity' && p.state) {
    if (p.state === 'normal') return new THREE.Color(0x44cc44)
    if (p.state === 'near_singular') return new THREE.Color(0xeebb22)
    if (p.state === 'singular') return new THREE.Color(0xee3333)
  }
  if (mode === 'manipulability' && p.yoshikawa !== undefined) {
    if (p.yoshikawa >= 0.5) return new THREE.Color(0x44cc44)
    if (p.yoshikawa >= 0.3) return new THREE.Color(0xeebb22)
    return new THREE.Color(0xee3333)
  }
  return new THREE.Color(0xcccccc)
}
