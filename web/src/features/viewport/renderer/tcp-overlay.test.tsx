// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import * as THREE from 'three'
import '@testing-library/jest-dom/vitest'
import { TcpOverlay, resolveTcpPosition, tcpPyramidDimensions } from './tcp-overlay'
import { useSceneStore } from '../store'
import type { SceneData, ToolFrame, TransformSnapshot } from '../types'

const tcpWithPose: ToolFrame = {
  baseFrameId: 2,
  offset: [0, 0, 0.1],
  resolvedPose: { position: [1, 2, 3], orientation: [1, 0, 0, 0] },
}
const tcpNoPose: ToolFrame = { baseFrameId: 2, offset: [0, 0, 0.1], resolvedPose: null }

const sceneData: SceneData = {
  frames: [
    { id: '1', parent: null, translation: [0, 0, 0], rotation: [1, 0, 0, 0], style: null },
    { id: '2', parent: null, translation: [0.5, 0, 0], rotation: [1, 0, 0, 0], style: null },
  ],
  links: [],
  jointAxes: [],
  twists: [],
  primitives: [],
  referenceDimension: 1,
}

const idle: TransformSnapshot = { kind: 'idle' }

beforeEach(() => {
  useSceneStore.getState().reset()
})
afterEach(() => cleanup())

describe('resolveTcpPosition — resolved pose wins, local derivation fallback (tcp-resolved-pose R5)', () => {
  it('uses resolvedPose.position when present (R5.1 — marker at (1,2,3))', () => {
    expect(resolveTcpPosition(tcpWithPose, idle, null)).toEqual([1, 2, 3])
  })

  it('falls back to the static frame translation + offset when resolvedPose is null (R5.2)', () => {
    expect(resolveTcpPosition(tcpNoPose, idle, sceneData)).toEqual([0.5, 0, 0.1])
  })

  it('prefers the execution transform over the static frame for the fallback', () => {
    const execution: TransformSnapshot = {
      kind: 'execution',
      transforms: [{ id: '2', translation: [0.7, 0.7, 0.7], rotation: [1, 0, 0, 0], scale: [1, 1, 1] }],
    }
    const [x, y, z] = resolveTcpPosition(tcpNoPose, execution, sceneData) ?? []
    expect(x).toBeCloseTo(0.7, 6)
    expect(y).toBeCloseTo(0.7, 6)
    expect(z).toBeCloseTo(0.8, 6)
  })

  it('uses the FK frame map when present for the fallback', () => {
    const fk: TransformSnapshot = { kind: 'fk', frames: new Map([['2', { pos: [0.2, 0.3, 0.4], quat: [1, 0, 0, 0] }]]) }
    expect(resolveTcpPosition(tcpNoPose, fk, sceneData)).toEqual([0.2, 0.3, 0.5])
  })

  it('returns null when the frame cannot be resolved', () => {
    expect(resolveTcpPosition(tcpNoPose, idle, null)).toBeNull()
  })
})

describe('TcpOverlay — consumes resolved pose for the marker (R5)', () => {
  it('renders the marker when resolvedPose is present, even without scene data', () => {
    act(() => {
      useSceneStore.setState({ data: null, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    expect(screen.getByTestId('tcp-overlay-marker')).toBeInTheDocument()
  })

  it('renders the fallback marker from static frame + offset when resolvedPose is null', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpNoPose })
    })
    render(<TcpOverlay />)
    expect(screen.getByTestId('tcp-overlay-marker')).toBeInTheDocument()
  })

  it('renders nothing when the frame cannot be resolved', () => {
    act(() => {
      useSceneStore.setState({ data: null, transformSnapshot: idle, activeTcp: tcpNoPose })
    })
    render(<TcpOverlay />)
    expect(screen.queryByTestId('tcp-overlay-marker')).not.toBeInTheDocument()
  })
})

describe('TcpOverlay — oriented pyramid marker (tcp-resolved-pose MODIFIED, pyramid)', () => {
  // The marker is a pyramid: a 4-radial-segment cone whose apex points +Y in
  // LOCAL cone space, rotated +π/2 about X so it points +Z of the tool frame.
  // The tool orientation quaternion (store [w,x,y,z] → THREE [x,y,z,w]) lives
  // on the marker group, composing with the local flip.

  it('renders a 4-segment pyramid (coneGeometry) instead of ring + sphere + axis lines', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    const cone = document.querySelector('conegeometry')!
    expect(cone).toBeInTheDocument()
    // 4 radial segments → square-base pyramid (not a round cone).
    const [radius, height, segments] = (cone.getAttribute('args') ?? '').split(',').map(Number)
    expect(segments).toBe(4)
    expect(radius).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    // The old ring + sphere + LinePoints geometry is gone.
    expect(document.querySelector('ringgeometry')).not.toBeInTheDocument()
    expect(document.querySelector('spheregeometry')).not.toBeInTheDocument()
    expect(document.querySelector('primitive')).not.toBeInTheDocument()
  })

  it('keeps data-testid="tcp-overlay-marker" and the resolveTcpPosition contract', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    expect(screen.getByTestId('tcp-overlay-marker')).toBeInTheDocument()
    // resolveTcpPosition unchanged: resolved pose wins, fallback derivation
    // stays, unresolvable frame stays null.
    expect(resolveTcpPosition(tcpWithPose, idle, null)).toEqual([1, 2, 3])
    expect(resolveTcpPosition(tcpNoPose, idle, sceneData)).toEqual([0.5, 0, 0.1])
    expect(resolveTcpPosition(tcpNoPose, idle, null)).toBeNull()
  })

  it('points the apex along LOCAL +Z of the tool frame (behavioral world direction)', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    // Behavioral check — compute the apex WORLD direction from the transforms
    // that actually render (mesh rotation + group quaternion), not from an
    // internal attribute: coneGeometry apex is local +Y; the mesh carries the
    // +Y→+Z flip (+π/2 about X); the marker group carries the tool quaternion.
    const mesh = document.querySelector('mesh')!
    const rotation = (mesh.getAttribute('rotation') ?? '').split(',').map(Number)
    const group = screen.getByTestId('tcp-overlay-marker')
    const quat = (group.getAttribute('quaternion') ?? '').split(',').map(Number)
    // tcpWithPose orientation is identity [w,x,y,z]=[1,0,0,0] → THREE [0,0,0,1].
    const apexLocalY = new THREE.Vector3(0, 1, 0) // cone apex in cone space
    const qFlip = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    const apexAfterFlip = apexLocalY.clone().applyQuaternion(qFlip)
    // Identity tool quaternion: apex direction stays the flipped one (+Z world).
    const apexWorld = apexAfterFlip.clone().applyQuaternion(new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]))
    expect(apexWorld.x).toBeCloseTo(0, 6)
    expect(apexWorld.y).toBeCloseTo(0, 6)
    expect(apexWorld.z).toBeCloseTo(1, 6)
  })

  it('follows a rotated tool frame: -90° about X carries LOCAL +Z to +Y world', () => {
    // A tool rotated -90° about X (store [w,x,y,z]=[cos45°, -sin45°, 0, 0])
    // carries its LOCAL +Z to +Y world — the apex must follow, never global +Z.
    const rotatedTcp: ToolFrame = {
      baseFrameId: 2,
      offset: [0, 0, 0.1],
      resolvedPose: { position: [1, 2, 3], orientation: [Math.SQRT1_2, -Math.SQRT1_2, 0, 0] },
    }
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: rotatedTcp })
    })
    render(<TcpOverlay />)
    const mesh = document.querySelector('mesh')!
    const rotation = (mesh.getAttribute('rotation') ?? '').split(',').map(Number)
    const quat = (screen.getByTestId('tcp-overlay-marker').getAttribute('quaternion') ?? '').split(',').map(Number)
    const apexLocalY = new THREE.Vector3(0, 1, 0)
    const apexAfterFlip = apexLocalY.clone().applyQuaternion(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
    )
    const apexWorld = apexAfterFlip.applyQuaternion(new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]))
    expect(apexWorld.x).toBeCloseTo(0, 6)
    expect(apexWorld.y).toBeCloseTo(1, 6)
    expect(apexWorld.z).toBeCloseTo(0, 6)
  })

  it('uses a subtle base: wireframe material or opacity ≤ 0.3', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    const material = document.querySelector('meshbasicmaterial')!
    const wireframe = material.getAttribute('wireframe') === 'true'
    const opacity = Number(material.getAttribute('opacity'))
    expect(wireframe || opacity <= 0.3).toBe(true)
  })

  it('bounds the pyramid height to ≤ 0.15 × referenceDimension with base edge ≈ 0.6 × height', () => {
    // Pure size contract: height = scaleFromRefDim(refDim, ratio) with ratio
    // picked so height never dominates robot geometry (≤ 15% of refDim).
    for (const refDim of [1.0, 0.2, 0.3, 2.0]) {
      const { height, baseEdge } = tcpPyramidDimensions(refDim)
      expect(height).toBeLessThanOrEqual(0.15 * refDim)
      expect(baseEdge).toBeCloseTo(0.6 * height, 10)
    }
    // And the rendered cone geometry matches those dimensions at refDim = 1.0.
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    const { height, baseEdge } = tcpPyramidDimensions(1.0)
    const cone = document.querySelector('conegeometry')!
    const [radius] = (cone.getAttribute('args') ?? '').split(',').map(Number)
    // Cone radius is the circumradius of the square base: r = edge / √2.
    expect(radius).toBeCloseTo(baseEdge / Math.SQRT2, 10)
    expect(Number((cone.getAttribute('args') ?? '').split(',')[1])).toBeCloseTo(height, 10)
  })
})
