import { useMemo } from 'react'
import * as THREE from 'three'
import { useWorkspaceStore } from '@/features/workspace-analysis/workspace-analysis-store'
import { CLOUD_WORKSPACE, CLOUD_GENERIC, SINGULAR_NORMAL, SINGULAR_NEAR, SINGULAR_SINGULAR, MANIP_HIGH, MANIP_MED, MANIP_LOW } from '@/shared/tokens'
import { classifyGrade, computeFallbackNormalized } from '@/shared/contracts/manipulability-normalization'
import { useSceneStore } from '../store'
import { scaleFromRefDim } from './scale'

export function PointCloud() {
  // Point size scales with the scene's referenceDimension (spec
  // scene-viewport-entities "Overlay Sizes Scale with referenceDimension") —
  // on small robots (icebot ~0.2 m) a fixed 0.015 point is proportionally 5×
  // bigger than on a 1 m robot. Absent scene data degrades to 1.0 via
  // scaleFromRefDim (no-op, current sizes preserved).
  const refDim = useSceneStore(s => s.data?.referenceDimension) ?? 1.0
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
      const c = pickColor(p, colorMode, refDim)
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [points, colorMode, refDim])

  if (!buffer || !visible) return null

  return (
    <points geometry={buffer}>
      <pointsMaterial size={scaleFromRefDim(refDim, 0.015)} sizeAttenuation vertexColors transparent opacity={0.7} depthTest depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

/** Point shape pickColor understands (subset of CloudPoint — pure function
 *  input, exported for the strict-TDD unit tests). */
export interface PickablePoint {
  position: [number, number, number]
  state?: string
  yoshikawa?: number
  grade?: 'low' | 'medium' | 'high'
  relativeManipulability?: number
}

/**
 * Color for a cloud point in the given mode.
 *
 * Manipulability mode priority:
 * 1. `relativeManipulability` (0–1, robot-relative) — when present, classify
 *    against simple [0.3, 0.7] thresholds: this answers "how good is this
 *    configuration for THIS robot?"
 * 2. `grade` (backend absolute grade) — legacy/absolute path
 * 3. `yoshikawa` fallback — legacy payloads, normalized classification
 */
export function pickColor(p: PickablePoint, mode: string, lRef: number = 1.0): THREE.Color {
  if (mode === 'workspace') return new THREE.Color(CLOUD_WORKSPACE)
  if (mode === 'singularity' && p.state) {
    if (p.state === 'normal') return new THREE.Color(SINGULAR_NORMAL)
    if (p.state === 'near_singular') return new THREE.Color(SINGULAR_NEAR)
    if (p.state === 'singular') return new THREE.Color(SINGULAR_SINGULAR)
  }
  if (mode === 'manipulability') {
    // 1. Robot-relative score (new path): classify against [0.3, 0.7]
    if (p.relativeManipulability !== undefined) {
      if (p.relativeManipulability < 0.3) return new THREE.Color(MANIP_LOW)
      if (p.relativeManipulability < 0.7) return new THREE.Color(MANIP_MED)
      return new THREE.Color(MANIP_HIGH)
    }
    // 2. Absolute backend grade (legacy path)
    if (p.grade) {
      if (p.grade === 'low') return new THREE.Color(MANIP_LOW)
      if (p.grade === 'medium') return new THREE.Color(MANIP_MED)
      return new THREE.Color(MANIP_HIGH)
    }
    // 3. Raw yoshikawa fallback (legacy payloads)
    if (p.yoshikawa !== undefined) {
      const grade = classifyGrade(computeFallbackNormalized(p.yoshikawa, lRef))
      if (grade === 'low') return new THREE.Color(MANIP_LOW)
      if (grade === 'medium') return new THREE.Color(MANIP_MED)
      return new THREE.Color(MANIP_HIGH)
    }
  }
  return new THREE.Color(CLOUD_GENERIC)
}
