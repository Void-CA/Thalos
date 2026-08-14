// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { ViewportTcpHud, deriveEndEffectorId, fmtTcpPosition } from './viewport-tcp-hud'
import { useSceneStore } from '../store'
import type { SceneData, SceneFrame, ToolFrame, TransformSnapshot } from '../types'

/** Minimal SceneFrame fixture — translation/rotation typed as SceneFrame expects. */
function frame(id: string, parent: string | null): SceneFrame {
  return { id, parent, translation: [0, 0, 0], rotation: [1, 0, 0, 0], style: null }
}

/**
 * viewport-tcp-hud (spec viewport-tcp-hud): floating HUD chip showing the
 * resolved TCP position as X/Y/Z in mm. The HUD reads the SAME
 * `activeTcp`/`transformSnapshot`/`data` subscription as the TcpOverlay —
 * a single shared source with NO polling, NO setInterval, NO second fetch.
 */

const tcpAt: ToolFrame = {
  baseFrameId: 2,
  offset: [0, 0, 0.1],
  resolvedPose: { position: [0.5, 0.3, 0.2], orientation: [1, 0, 0, 0] },
}
const tcpUnresolvable: ToolFrame = { baseFrameId: 2, offset: [0, 0, 0.1], resolvedPose: null }

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

describe('deriveEndEffectorId — leaf frame selection from scene frames (R5)', () => {
  it('selects the last frame of a linear chain (A → B → C)', () => {
    const frames = [frame('A', null), frame('B', 'A'), frame('C', 'B')]
    expect(deriveEndEffectorId(frames)).toBe('C')
  })

  it('selects deterministically among multiple leaves: highest array index wins', () => {
    const frames = [frame('A', null), frame('B', 'A'), frame('C', 'A')]
    // B and C are both leaves (never appear as a parent) → highest index is C.
    expect(deriveEndEffectorId(frames)).toBe('C')
  })

  it('returns null when the frame list is empty', () => {
    expect(deriveEndEffectorId([])).toBeNull()
  })

  it('returns null when the frame list is undefined', () => {
    expect(deriveEndEffectorId(undefined)).toBeNull()
  })

  it('returns the single root frame id when a frame has parent null and no children', () => {
    expect(deriveEndEffectorId([frame('R', null)])).toBe('R')
  })

  it('returns null when every frame id appears as a parent (cycle: A↔B)', () => {
    const frames = [frame('A', 'B'), frame('B', 'A')]
    expect(deriveEndEffectorId(frames)).toBeNull()
  })
})

describe('fmtTcpPosition — world meters → mm below 1 m, m above (2–3 decimals, fmtDelta style)', () => {
  it('renders sub-meter values as whole mm with 2 decimals', () => {
    expect(fmtTcpPosition(0.5)).toBe('500.00 mm')
    expect(fmtTcpPosition(0.3)).toBe('300.00 mm')
    expect(fmtTcpPosition(0.2)).toBe('200.00 mm')
  })

  it('renders meter values with 3 decimals in m', () => {
    expect(fmtTcpPosition(1.25)).toBe('1.250 m')
  })
})

describe('ViewportTcpHud — displays the resolved TCP position (viewport-tcp-hud)', () => {
  it('shows X/Y/Z in mm from the resolved pose', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpAt })
    })
    render(<ViewportTcpHud />)
    const hud = screen.getByTestId('viewport-tcp-hud')
    expect(hud).toHaveTextContent('X: 500.00 mm')
    expect(hud).toHaveTextContent('Y: 300.00 mm')
    expect(hud).toHaveTextContent('Z: 200.00 mm')
  })

  it('updates from the shared transformSnapshot when execution ticks move the frame', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: tcpUnresolvable })
    })
    render(<ViewportTcpHud />)
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('X: 500.00 mm')

    // Same snapshot source that drives the robot model — no polling, the
    // subscription re-renders on the next tick.
    act(() => {
      useSceneStore.setState({
        transformSnapshot: {
          kind: 'execution',
          transforms: [{ id: '2', translation: [0.7, 0.8, 0.5], rotation: [1, 0, 0, 0], scale: [1, 1, 1] }],
        } as TransformSnapshot,
      })
    })
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('X: 700.00 mm')
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('Y: 800.00 mm')
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('Z: 600.00 mm')
  })

  it('shows the derived end-effector position when no TCP is active (R1)', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: null })
    })
    render(<ViewportTcpHud />)
    const hud = screen.getByTestId('viewport-tcp-hud')
    // Frames '1' [0,0,0] and '2' [0.5,0,0] are both leaves (no children) →
    // highest array index wins → frame '2'.
    expect(hud).toHaveTextContent('X: 500.00 mm')
    expect(hud).toHaveTextContent('Y: 0.00 mm')
    expect(hud).toHaveTextContent('Z: 0.00 mm')
  })

  it('updates the derived end-effector live from execution ticks (R2 shared subscription)', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: null })
    })
    render(<ViewportTcpHud />)
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('X: 500.00 mm')

    // Same snapshot source that drives the robot model — no polling, the
    // subscription re-renders on the next tick.
    act(() => {
      useSceneStore.setState({
        transformSnapshot: {
          kind: 'execution',
          transforms: [{ id: '2', translation: [0.7, 0.8, 0.5], rotation: [1, 0, 0, 0], scale: [1, 1, 1] }],
        } as TransformSnapshot,
      })
    })
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('X: 700.00 mm')
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('Y: 800.00 mm')
    expect(screen.getByTestId('viewport-tcp-hud')).toHaveTextContent('Z: 500.00 mm')
  })

  it('keeps the compact legend-style format: TCP label + X/Y/Z under testid viewport-tcp-hud (R3)', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData, transformSnapshot: idle, activeTcp: null })
    })
    render(<ViewportTcpHud />)
    const hud = screen.getByTestId('viewport-tcp-hud')
    expect(hud).toHaveTextContent('TCP')
    expect(hud).toHaveTextContent('X: 500.00 mm')
    expect(hud).toHaveTextContent('Y: 0.00 mm')
    expect(hud).toHaveTextContent('Z: 0.00 mm')
  })

  it('is hidden when there is no scene data (R4)', () => {
    act(() => {
      useSceneStore.setState({ data: null, transformSnapshot: idle, activeTcp: null })
    })
    render(<ViewportTcpHud />)
    expect(screen.queryByTestId('viewport-tcp-hud')).not.toBeInTheDocument()
  })

  it('is hidden when data exists but there are no frames and no TCP (R4)', () => {
    act(() => {
      useSceneStore.setState({ data: { ...sceneData, frames: [] }, transformSnapshot: idle, activeTcp: null })
    })
    render(<ViewportTcpHud />)
    expect(screen.queryByTestId('viewport-tcp-hud')).not.toBeInTheDocument()
  })

  it('is hidden when the TCP position cannot be resolved', () => {
    act(() => {
      useSceneStore.setState({ data: null, transformSnapshot: idle, activeTcp: tcpUnresolvable })
    })
    render(<ViewportTcpHud />)
    expect(screen.queryByTestId('viewport-tcp-hud')).not.toBeInTheDocument()
  })
})
