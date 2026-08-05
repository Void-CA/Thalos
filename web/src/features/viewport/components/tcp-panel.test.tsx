// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { TcpPanel } from './tcp-panel'
import { useSceneStore } from '../store'
import type { SceneData, RuntimeInfo, ToolFrame } from '../types'

const mocks = vi.hoisted(() => ({ selectToolFrame: vi.fn() }))

vi.mock('../services/service-context', () => ({
  useSceneService: () => ({ selectToolFrame: mocks.selectToolFrame }),
}))

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

const runtime: RuntimeInfo = {
  robot: { id: 'planar_2r', display_name: 'Planar 2R', dof: 2, joints: [] },
  joints: [0, 0],
  generatedAt: '2026-08-04T00:00:00Z',
}

const frame2Tcp: ToolFrame = { baseFrameId: 2, offset: [0, 0, 0.1], resolvedPose: null }
const tcpWithPose: ToolFrame = {
  baseFrameId: 2,
  offset: [0, 0, 0.1],
  resolvedPose: { position: [1, 2, 3], orientation: [1, 0, 0, 0] },
}

/** Snapshot the mocked service returns — the TCP selected on frame 2 with a
 *  resolved pose, so the panel can display the updated value (R2.1). */
const selectedSnapshot = (activeTcp: ToolFrame | null) => ({
  scene: sceneData,
  runtime,
  ikResult: null,
  activePlan: null,
  activeTcp,
  execution: null,
})

const frameSelect = () => screen.getByRole('combobox', { name: 'TCP base frame' })

function seedScene(activeTcp: ToolFrame | null = null) {
  act(() => {
    useSceneStore.getState().applyScene(sceneData, runtime, null, null, activeTcp, null)
  })
}

beforeEach(() => {
  mocks.selectToolFrame.mockClear()
  useSceneStore.getState().reset()
  seedScene()
})
afterEach(() => cleanup())

describe('TcpPanel — frame selector + offset inputs + resolved pose (tcp-resolved-pose R2/R3)', () => {
  it('renders a frame selector listing the scene frames plus a clear option', () => {
    render(<TcpPanel />)

    const values = within(frameSelect()).getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(values).toEqual(['', '1', '2'])
  })

  it('shows the existing no-TCP message when nothing is selected', () => {
    render(<TcpPanel />)

    expect(screen.getByText(/No TCP selected — using flange/)).toBeInTheDocument()
  })

  it('posts selectToolFrame(2, [0,0,0.1]) when frame 2 is selected after offset Z 0.1 (R2.1)', async () => {
    mocks.selectToolFrame.mockResolvedValue(selectedSnapshot(tcpWithPose))
    render(<TcpPanel />)

    fireEvent.change(screen.getByLabelText('Offset Z'), { target: { value: '0.1' } })
    fireEvent.change(frameSelect(), { target: { value: '2' } })

    await waitFor(() => expect(mocks.selectToolFrame).toHaveBeenCalledWith(2, [0, 0, 0.1]))
    // R2.1: the panel displays the updated resolved_pose from the response.
    await waitFor(() => {
      const block = screen.getByTestId('tcp-resolved-pose')
      expect(block.textContent).toContain('1.000') // position X
      expect(block.textContent).toContain('3.000') // position Z
    })
  })

  it('posts selectToolFrame(null) when the selector is cleared (R2 clear scenario)', async () => {
    mocks.selectToolFrame.mockResolvedValue(selectedSnapshot(null))
    seedScene(frame2Tcp)
    render(<TcpPanel />)

    // A TCP is selected → the selector shows frame 2.
    expect((frameSelect() as HTMLSelectElement).value).toBe('2')
    fireEvent.change(frameSelect(), { target: { value: '' } })

    await waitFor(() => expect(mocks.selectToolFrame).toHaveBeenCalledWith(null))
    // Clearing drops resolved_pose → the no-TCP message returns.
    await waitFor(() =>
      expect(screen.getByText(/No TCP selected — using flange/)).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('tcp-resolved-pose')).not.toBeInTheDocument()
  })

  it('displays resolvedPose from the store when the active TCP carries it', () => {
    seedScene(tcpWithPose)
    render(<TcpPanel />)

    const block = screen.getByTestId('tcp-resolved-pose')
    expect(block.textContent).toContain('2.000') // position Y
    expect(block.textContent).toContain('0.000') // orientation zeros
  })
})
