// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { TcpOverlay, resolveTcpPosition } from './tcp-overlay'
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
