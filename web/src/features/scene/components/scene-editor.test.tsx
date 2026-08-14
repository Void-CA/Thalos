// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { SceneEditor } from './scene-editor'
import { useDomainSceneStore, SEEDED_OBJECTS, SEEDED_LOCATIONS, DEFAULT_APPROACH_HEIGHT } from '../store'
import type { SceneFile } from '@/shared/contracts'

/**
 * SceneEditor — density refactor (ui-workspace-density spec).
 *
 * R1: the panel is an accordion with four sections in fixed order
 *     Setup (expanded by default) / Objects / Locations / Tools (collapsed).
 * R2: the robot identity renders as a single compact `Robot: {name}` line
 *     inside Setup — no standalone Robot section/heading.
 * R3: the SCARA approach height is a single labeled line with a ⓘ tooltip —
 *     the explanation never occupies permanent multi-line space.
 * R11: all store actions and the Load/Save Scene IO remain wired identically.
 */
describe('SceneEditor — accordion structure (R1)', () => {
  beforeEach(() => {
    act(() => {
      useDomainSceneStore.setState({ objects: [], locations: [], tools: [] })
    })
  })
  afterEach(() => cleanup())

  it('R1 — renders four accordion sections in fixed order Setup→Objects→Locations→Tools', () => {
    render(<SceneEditor />)
    const triggers = screen.getAllByRole('button', { name: /^(Setup|Objects|Locations|Tools)$/ })
    expect(triggers.map((t) => t.textContent?.trim())).toEqual([
      'Setup',
      'Objects',
      'Locations',
      'Tools',
    ])
  })

  it('R1 — Setup is expanded by default; Objects, Locations and Tools are collapsed', () => {
    render(<SceneEditor />)
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Objects' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Locations' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('R1 — clicking a collapsed header expands it and mounts its content (user toggle)', () => {
    act(() => {
      useDomainSceneStore.setState({
        objects: [
          { id: 'obj-1', name: 'Object 1', pose: { position: [0, 0, 0], orientation: [1, 0, 0, 0] } },
        ],
      })
    })
    render(<SceneEditor />)
    const objects = screen.getByRole('button', { name: 'Objects' })
    expect(objects).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(objects)
    expect(objects).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByDisplayValue('Object 1')).toBeInTheDocument()
  })
})

describe('SceneEditor — robot identity inline in Setup (R2)', () => {
  afterEach(() => cleanup())

  it('R2 — robot renders as a compact `Robot: {name}` line inside Setup with no standalone heading', () => {
    act(() => {
      useDomainSceneStore.setState({ robot: { name: 'icebot', urdf: 'docs/execution/robot/icebot.urdf' } })
    })
    render(<SceneEditor />)
    expect(screen.getByText('Robot: icebot')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Robot' })).not.toBeInTheDocument()
  })
})

describe('SceneEditor — keyboard accessibility (R12)', () => {
  afterEach(() => cleanup())

  it('R12 — the accordion trigger is a focusable native button; activation toggles the section and keeps focus on the trigger', () => {
    render(<SceneEditor />)
    const trigger = screen.getByRole('button', { name: 'Objects' })
    // Native button: browsers fire click on Enter/Space (implicit keyboard
    // activation) — the keyboard path reduces to this activation.
    expect(trigger.tagName).toBe('BUTTON')
    trigger.focus()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveFocus()
  })
})

describe('SceneEditor — list layout (V6) + SCARA wiring', () => {
  beforeEach(() => {
    act(() => {
      useDomainSceneStore.setState({ objects: [], locations: [], tools: [] })
    })
  })
  afterEach(() => cleanup())

  it('shows every defined object once Objects is expanded — no inner scroll cap (V6)', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Objects' }))
    // All three objects are visible in the DOM (no max-height scroll container
    // truncating the list for a demo-sized scene).
    expect(screen.getByDisplayValue('Object 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Object 2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Object 3')).toBeInTheDocument()
  })

  it('renders the SCARA approach height field (Setup is open by default) and edits the store', () => {
    render(<SceneEditor />)
    const input = screen.getByLabelText('SCARA approach height (metres)')
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '0.12' } })
    expect(useDomainSceneStore.getState().approachHeight).toBe(0.12)
  })

  it('R11 — editing the Home pose in Setup writes through setHomePose to the store', () => {
    render(<SceneEditor />)
    fireEvent.change(screen.getByLabelText('Home X'), { target: { value: '0.9' } })
    fireEvent.change(screen.getByLabelText('Home Z'), { target: { value: '0.42' } })
    expect(useDomainSceneStore.getState().homePose.position[0]).toBe(0.9)
    expect(useDomainSceneStore.getState().homePose.position[2]).toBe(0.42)
  })

  it('R3 — approach height is a single labeled line; the explanation lives in a ⓘ tooltip, never in permanent multi-line space', async () => {
    render(<SceneEditor />)
    // Single labeled line: label + input + unit.
    expect(screen.getByLabelText('SCARA approach height (metres)')).toBeInTheDocument()
    // The explanation must NOT occupy permanent space — absent until the
    // tooltip opens.
    expect(screen.queryByText(/Prismatic retraction height/)).not.toBeInTheDocument()
    // ⓘ hover opens the contextual tooltip.
    const help = screen.getByRole('button', { name: 'SCARA approach height help' })
    fireEvent.mouseEnter(help)
    expect(await screen.findByText(/Prismatic retraction height/)).toBeInTheDocument()
  })
})

describe('SceneEditor — numeric panel + Load/Save Scene IO (D12/D14)', () => {
  const demoSceneFile: SceneFile = {
    schema_version: '1',
    robot: { name: 'icebot', urdf: 'docs/execution/robot/icebot.urdf' },
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
    // R1: entity lists are collapsed by default — expand both sections.
    fireEvent.click(screen.getByRole('button', { name: 'Objects' }))
    fireEvent.click(screen.getByRole('button', { name: 'Locations' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Objects' }))
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
    // R2: the identity is the compact inline line inside Setup.
    expect(screen.getByText('Robot: icebot')).toBeInTheDocument()
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
    expect(useDomainSceneStore.getState().robot).toEqual({ name: 'icebot', urdf: 'docs/execution/robot/icebot.urdf' })
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
