// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { TcpOverlay, resolveTcpPosition, tcpPyramidDimensions, tcpApexDirection } from './tcp-overlay'
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
  // LOCAL cone space, rotated -π/2 about X so it points +Z of the tool frame.
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

  it('orientates the cone so its local apex points LOCAL +Z of the tool frame', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpWithPose })
    })
    render(<TcpOverlay />)
    const mesh = document.querySelector('mesh')!
    // The cone mesh carries the local +Y→+Z flip (-π/2 about X); the marker
    // group carries the tool orientation quaternion (THREE order, identity
    // [w,x,y,z]=[1,0,0,0] → [x,y,z,w]=[0,0,0,1]).
    const rotation = (mesh.getAttribute('rotation') ?? '').split(',').map(Number)
    expect(rotation[0]).toBeCloseTo(-Math.PI / 2, 6)
    expect(rotation[1]).toBeCloseTo(0, 6)
    expect(rotation[2]).toBeCloseTo(0, 6)
    expect(screen.getByTestId('tcp-overlay-marker').getAttribute('quaternion')).toBe('0,0,0,1')
  })

  it('points the apex along LOCAL +Z: identity orientation → +Z world, 90° X rotation → +Y world', () => {
    // Pure direction contract (tcpApexDirection): the apex is LOCAL +Z of the
    // tool frame, never global +Z.
    const [x, y, z] = tcpApexDirection([1, 0, 0, 0])
    expect(x).toBeCloseTo(0, 10)
    expect(y).toBeCloseTo(0, 10)
    expect(z).toBeCloseTo(1, 10)
    // 90° rotation about X (the rotation that carries LOCAL +Z to +Y world)
    // — store [w,x,y,z] = [cos(-45°), sin(-45°), 0, 0].
    const [x2, y2, z2] = tcpApexDirection([Math.SQRT1_2, -Math.SQRT1_2, 0, 0])
    expect(x2).toBeCloseTo(0, 10)
    expect(y2).toBeCloseTo(1, 10)
    expect(z2).toBeCloseTo(0, 10)
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
