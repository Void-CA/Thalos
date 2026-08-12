import { useMemo } from 'react'
import * as THREE from 'three'
import { useWorkspaceStore, type CloudPoint } from '@/features/workspace-analysis/workspace-analysis-store'
import { CLOUD_WORKSPACE, CLOUD_GENERIC, SINGULAR_NORMAL, SINGULAR_NEAR, SINGULAR_SINGULAR, MANIP_HIGH, MANIP_MED, MANIP_LOW } from '@/shared/tokens'

export function PointCloud() {
  const colorMode = useWorkspaceStore(s => s.colorMode)
  const visible = useWorkspaceStore(s => s.showPointCloud)
  const ws = useWorkspaceStore(s => s.workspaceSamples)
  const sg = useWorkspaceStore(s => s.singularitySamples)
  const mp = useWorkspaceStore(s => s.manipulabilitySamples)

  const points = colorMode === 'workspace' ? ws
    : colorMode === 'singularity' ? sg
    : colorMode === 'manipulability' ? mp : null

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
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [points, colorMode])

  if (!buffer || !visible) return null

  return (
    <points geometry={buffer}>
      <pointsMaterial size={0.015} sizeAttenuation vertexColors transparent opacity={0.7} depthTest depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

function pickColor(p: CloudPoint, mode: string): THREE.Color {
  if (mode === 'workspace') return new THREE.Color(CLOUD_WORKSPACE)
  if (mode === 'singularity' && p.state) {
    if (p.state === 'normal') return new THREE.Color(SINGULAR_NORMAL)
    if (p.state === 'near_singular') return new THREE.Color(SINGULAR_NEAR)
    if (p.state === 'singular') return new THREE.Color(SINGULAR_SINGULAR)
  }
  if (mode === 'manipulability' && p.yoshikawa !== undefined) {
    if (p.yoshikawa >= 0.5) return new THREE.Color(MANIP_HIGH)
    if (p.yoshikawa >= 0.3) return new THREE.Color(MANIP_MED)
    return new THREE.Color(MANIP_LOW)
  }
  return new THREE.Color(CLOUD_GENERIC)
}
