// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { SceneWorkspace } from './SceneWorkspace'
import { useDomainSceneStore, type SceneObject } from './store'
import type { PoseDef } from '@/shared/contracts'

/**
 * Escena area (area-scene spec, S2):
 * - Scene panel is FULL-HEIGHT: SceneWorkspace renders the SceneEditor at
 *   full panel height with NO collapsible <details> wrapper ("Scene Panel
 *   Full-Height").
 * - The scene store is renamed to `useDomainSceneStore` ("Scene Store
 *   Renamed" — no collision with the viewport's `useSceneStore`).
 */
function renderWorkspace() {
  return render(<SceneWorkspace />)
}

const seededObject: SceneObject = {
  id: 'bolt-1',
  name: 'Bolt',
  pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] },
}
const seededHome: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

beforeEach(() => {
  // The domain scene store has no reset action — restore the canonical seed.
  useDomainSceneStore.setState({
    objects: [seededObject],
    locations: [],
    tools: [],
    homePose: seededHome,
  })
})
afterEach(() => cleanup())

describe('Escena area — full-height SceneWorkspace (area-scene spec)', () => {
  it('renders the Scene editor with objects/locations/tools/home at full height', () => {
    renderWorkspace()
    // SceneEditor sections are all present (behavioral output, not CSS classes).
    expect(screen.getByText('Objects')).toBeInTheDocument()
    expect(screen.getByText('Locations')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('has NO collapsible <details> wrapper (full-height panel, not a sub-panel)', () => {
    const { container } = renderWorkspace()
    expect(container.querySelector('details')).toBeNull()
  })

  it('is the exclusive owner of the Scene editor: no Program/Diagnostics panels', () => {
    renderWorkspace()
    expect(screen.queryByRole('heading', { name: 'Program' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Diagnostics' })).not.toBeInTheDocument()
  })

  it('edits flow through useDomainSceneStore (addObject appears in the editor)', () => {
    renderWorkspace()
    act(() => {
      useDomainSceneStore.getState().addObject({
        id: 'obj-2',
        name: 'Object 2',
        pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] },
      })
    })
    expect(screen.getByDisplayValue('Object 2')).toBeInTheDocument()
  })

  it('reads the seeded scene from useDomainSceneStore (Bolt visible)', () => {
    renderWorkspace()
    expect(screen.getByDisplayValue('Bolt')).toBeInTheDocument()
  })

  it('does not render the viewport store (no 3D canvas here)', () => {
    renderWorkspace()
    expect(screen.queryByTestId('viewport-stub')).not.toBeInTheDocument()
  })
})

describe('Scene editor poses (scene-editor-poses spec)', () => {
  it('edits an object pose through PoseInputs → updateObject stores it', () => {
    renderWorkspace()
    fireEvent.change(screen.getByLabelText('bolt-1 X'), { target: { value: '2.5' } })
    const obj = useDomainSceneStore.getState().objects.find((o) => o.id === 'bolt-1')
    expect(obj?.pose.position[0]).toBe(2.5)
  })

  it('converts Yaw to a unit quaternion when the object orientation is edited (R1)', () => {
    renderWorkspace()
    fireEvent.change(screen.getByLabelText('bolt-1 Yaw'), { target: { value: '45' } })
    const obj = useDomainSceneStore.getState().objects.find((o) => o.id === 'bolt-1')
    expect(obj?.pose.orientation[0]).toBeCloseTo(0.924, 3)
    expect(obj?.pose.orientation[1]).toBeCloseTo(0, 6)
    expect(obj?.pose.orientation[2]).toBeCloseTo(0, 6)
    expect(obj?.pose.orientation[3]).toBeCloseTo(0.383, 3)
  })

  it('adds an object with a user-defined pose (R2: X=2.0,Y=0.5,Z=0.3,Yaw=90° → [0.707,0,0.707,0])', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Add object' }))
    fireEvent.change(screen.getByLabelText('obj-2 X'), { target: { value: '2.0' } })
    fireEvent.change(screen.getByLabelText('obj-2 Y'), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('obj-2 Z'), { target: { value: '0.3' } })
    fireEvent.change(screen.getByLabelText('obj-2 Yaw'), { target: { value: '90' } })
    const added = useDomainSceneStore.getState().objects.find((o) => o.id === 'obj-2')
    expect(added?.pose.position).toEqual([2.0, 0.5, 0.3])
    expect(added?.pose.orientation[0]).toBeCloseTo(0.707, 3)
    expect(added?.pose.orientation[1]).toBeCloseTo(0, 6)
    expect(added?.pose.orientation[2]).toBeCloseTo(0, 6)
    expect(added?.pose.orientation[3]).toBeCloseTo(0.707, 3)
  })

  it('adds an object defaulting to the bolt seed pose (R3 — no inline literals)', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Add object' }))
    const added = useDomainSceneStore.getState().objects.find((o) => o.id === 'obj-2')
    expect(added?.pose).toEqual({ position: [1.8, 0, 0.4], orientation: [1, 0, 0, 0] })
  })

  it('adds a location with a user-defined pose, not the hardcoded tray values (R2)', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    fireEvent.change(screen.getByLabelText('loc-1 X'), { target: { value: '1.0' } })
    fireEvent.change(screen.getByLabelText('loc-1 Y'), { target: { value: '2.0' } })
    fireEvent.change(screen.getByLabelText('loc-1 Z'), { target: { value: '0.1' } })
    const added = useDomainSceneStore.getState().locations.find((l) => l.id === 'loc-1')
    expect(added?.pose.position).toEqual([1.0, 2.0, 0.1])
  })
})
