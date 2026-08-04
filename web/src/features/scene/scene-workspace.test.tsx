// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
