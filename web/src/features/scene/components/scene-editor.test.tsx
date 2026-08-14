// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { SceneEditor } from './scene-editor'
import { useDomainSceneStore, SEEDED_OBJECTS, SEEDED_LOCATIONS, DEFAULT_APPROACH_HEIGHT } from '../store'
import type { SceneFile } from '@/shared/contracts'

/**
 * Visual audit (resilience-presentation PR4, V6-V9): the scene editor's
 * section titles are real headings (V9 heading hierarchy — no more bare
 * spans), and the object/location lists are NOT capped by a scroll container
 * (V6 — a demo scene with a few items needs no inner scrollbar).
 */
describe('SceneEditor — visual audit headings and list layout (V6, V9)', () => {
  beforeEach(() => {
    act(() => {
      useDomainSceneStore.setState({ objects: [], locations: [], tools: [] })
    })
  })
  afterEach(() => cleanup())

  it('renders Objects / Locations / Tools / Home as proper headings (V9)', () => {
    render(<SceneEditor />)
    expect(screen.getByRole('heading', { name: 'Objects' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Locations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('shows every defined object without an inner scroll cap (V6)', () => {
    act(() => {
      useDomainSceneStore.setState({
        objects: [
          { id: 'obj-1', name: 'Object 1', pose: { position: [0, 0, 0], orientation: [1, 0, 0, 0] } },
          { id: 'obj-2', name: 'Object 2', pose: { position: [1, 0, 0], orientation: [1, 0, 0, 0] } },
          { id: 'obj-3', name: 'Object 3', pose: { position: [2, 0, 0], orientation: [1, 0, 0, 0] } },
        ],
      })
    })
    render(<SceneEditor />)
    // All three objects are visible in the DOM (no max-height scroll container
    // truncating the list for a demo-sized scene).
    expect(screen.getByDisplayValue('Object 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Object 2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Object 3')).toBeInTheDocument()
  })

  it('renders the SCARA approach height field and edits it', () => {
    render(<SceneEditor />)
    const input = screen.getByLabelText('SCARA approach height (metres)')
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '0.12' } })
    expect(useDomainSceneStore.getState().approachHeight).toBe(0.12)
  })
})

describe('SceneEditor — numeric panel + Load/Save Scene IO (D12/D14)', () => {
  const demoSceneFile: SceneFile = {
    schema_version: '1',
    robot: { name: 'icebot', urdf: 'docs/robot/icebot.urdf' },
    objects: [
      { id: 'box-1', kind: 'box', name: 'Box 1', pose: { position: [0.2, 0.1, 0.0], orientation: [0.0, 0.0, 0.0, 1.0] } },
    ],
    fixtures: [],
    locations: [
      { id: 'tray-1', kind: 'placement_target', pose: { position: [0.3, -0.2, 0.0], orientation: [0.0, 0.0, 0.0, 1.0] } },
    ],
    home_pose: { position: [0.0, 0.0, 0.5], orientation: [0.0, 0.0, 0.0, 1.0] },
    approach_height: 0.05,
  }

  beforeEach(() => {
    act(() => {
      useDomainSceneStore.setState({
        objects: SEEDED_OBJECTS.map((o) => ({ ...o })),
        locations: SEEDED_LOCATIONS.map((l) => ({ ...l })),
        tools: [],
        homePose: { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] },
        approachHeight: DEFAULT_APPROACH_HEIGHT,
        robot: null,
      })
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders X/Y/Z numeric inputs for every Object and Location pose — no gizmos', () => {
    render(<SceneEditor />)
    // PoseInputs labels every axis with the entity id ("bolt-1 X", "tray-1 Z").
    expect(screen.getByLabelText('bolt-1 X')).toBeInTheDocument()
    expect(screen.getByLabelText('bolt-1 Y')).toBeInTheDocument()
    expect(screen.getByLabelText('bolt-1 Z')).toBeInTheDocument()
    expect(screen.getByLabelText('tray-1 X')).toBeInTheDocument()
    expect(screen.getByLabelText('tray-1 Z')).toBeInTheDocument()
    // No gizmo surface: zero canvas/drag affordances in the panel.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('typing X/Y/Z updates the object pose in the store (numeric panel edits)', () => {
    render(<SceneEditor />)
    fireEvent.change(screen.getByLabelText('bolt-1 X'), { target: { value: '0.55' } })
    fireEvent.change(screen.getByLabelText('bolt-1 Z'), { target: { value: '0.03' } })
    const pose = useDomainSceneStore.getState().objects[0].pose
    expect(pose.position[0]).toBe(0.55)
    expect(pose.position[2]).toBe(0.03)
  })

  it('shows the loaded robot name read-only (D14) — never an editable input', () => {
    act(() => {
      useDomainSceneStore.getState().loadSceneFile(demoSceneFile)
    })
    render(<SceneEditor />)
    expect(screen.getByText('icebot')).toBeInTheDocument()
    // The name is a display, not an input — nothing editable holds it.
    expect(screen.queryByDisplayValue('icebot')).not.toBeInTheDocument()
  })

  it('[Load Scene] local picker hydrates the store from a SceneFile (D12)', async () => {
    render(<SceneEditor />)
    const input = screen.getByLabelText('Load scene file') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [new File([JSON.stringify(demoSceneFile)], 'scene.json', { type: 'application/json' })],
      },
    })
    await waitFor(() => expect(useDomainSceneStore.getState().objects[0].id).toBe('box-1'))
    expect(useDomainSceneStore.getState().robot).toEqual({ name: 'icebot', urdf: 'docs/robot/icebot.urdf' })
  })

  it('[Load Scene] invalid JSON/shape shows an error and leaves the store unchanged', async () => {
    render(<SceneEditor />)
    const input = screen.getByLabelText('Load scene file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['not json'], 'bad.json', { type: 'application/json' })] } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid scene file/i)
    // No mutation: the seeded scene is intact.
    expect(useDomainSceneStore.getState().objects.map((o) => o.id)).toEqual(['bolt-1'])
  })

  it('[Save Scene] downloads a SceneFile JSON via browser download (D12)', async () => {
    let captured: Blob | null = null
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<SceneEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Save Scene' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(await captured!.text()) as SceneFile
    expect(saved.schema_version).toBe('1')
    expect(saved.objects[0]).toMatchObject({ id: 'bolt-1', kind: 'object' })
    expect(saved.locations[0].kind).toBe('placement_target')
  })

  it('[Load Scene] demo-API path (prop-ready): loadDemoScene hydrates the store', async () => {
    const loadDemoScene = vi.fn().mockResolvedValue(demoSceneFile)
    render(<SceneEditor loadDemoScene={loadDemoScene} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load Scene' }))

    await waitFor(() => expect(loadDemoScene).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useDomainSceneStore.getState().objects[0].id).toBe('box-1'))
  })
})
