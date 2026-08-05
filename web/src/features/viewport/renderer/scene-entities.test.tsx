// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { SceneEntities } from './scene-entities'
import { useDomainSceneStore } from '@/features/scene/store'
import type { SceneObject, SceneLocation } from '@/features/scene/store'

/**
 * Scene viewport entities (scene-viewport-entities spec, PR-4):
 *
 * - R1: entities from useDomainSceneStore render as meshes at world coords
 *   with name labels.
 * - R2: empty store → renders null, no error.
 * - R1.3: editing a pose re-renders the mesh (live store subscription).
 *
 * Canvas stub (spec R3 / design D9 — task-editor.test.tsx "viewport-stub"
 * pattern): NO WebGL <Canvas> is instantiated. SceneEntities is a pure
 * store→R3F-elements mapping, so it renders directly in jsdom (same approach
 * as tcp-overlay.test.tsx): R3F elements degrade to inert DOM custom elements
 * carrying the declared pose as attributes, and only drei's Html (which needs
 * a Canvas context via useThree) is stubbed as a pass-through so label text
 * becomes queryable DOM.
 */

// drei Html portals to a DOM overlay anchored by the R3F camera (useThree) —
// no Canvas context in jsdom, so stub it as a pass-through that renders the
// label children as plain DOM.
vi.mock('@react-three/drei', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/drei')>()
  return {
    ...actual,
    Html: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  }
})

const boltAt: SceneObject = {
  id: 'bolt-1',
  name: 'Bolt',
  pose: { position: [1.5, 0.3, 0.5], orientation: [0.924, 0, 0.383, 0] },
}

const trayAt: SceneLocation = {
  id: 'tray-1',
  name: 'Tray',
  pose: { position: [0.8, -0.3, 0], orientation: [1, 0, 0, 0] },
}

beforeEach(() => {
  useDomainSceneStore.setState({ objects: [], locations: [], tools: [] })
})
afterEach(() => cleanup())

describe('SceneEntities — renders objects/locations from the domain store (R1)', () => {
  it('renders an object mesh at its world pose with a name label (R1.1)', () => {
    act(() => {
      useDomainSceneStore.setState({ objects: [boltAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-bolt-1')
    expect(mesh).toBeInTheDocument()
    expect(mesh.getAttribute('position')).toBe('1.5,0.3,0.5')
    // [w,x,y,z] = [0.924,0,0.383,0] → THREE [x,y,z,w] = [0,0.383,0,0.924]
    expect(mesh.getAttribute('quaternion')).toBe('0,0.383,0,0.924')
    expect(screen.getByText('Bolt')).toBeInTheDocument()
  })

  it('renders a location mesh at its world pose with a name label (R1.2)', () => {
    act(() => {
      useDomainSceneStore.setState({ locations: [trayAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-tray-1')
    expect(mesh).toBeInTheDocument()
    expect(mesh.getAttribute('position')).toBe('0.8,-0.3,0')
    expect(screen.getByText('Tray')).toBeInTheDocument()
  })
})

describe('SceneEntities — tolerates an empty store (R2)', () => {
  it('renders null when there are no objects and no locations', () => {
    const { container } = render(<SceneEntities />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Bolt')).not.toBeInTheDocument()
    expect(screen.queryByText('Tray')).not.toBeInTheDocument()
  })
})

describe('SceneEntities — updates when an entity pose is edited (R1.3)', () => {
  it('re-renders the mesh at the new pose after updateObject', () => {
    act(() => {
      useDomainSceneStore.setState({ objects: [boltAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-bolt-1')
    expect(mesh.getAttribute('position')).toBe('1.5,0.3,0.5')

    act(() => {
      useDomainSceneStore.getState().updateObject('bolt-1', {
        pose: { position: [2, 0.5, 0.1], orientation: [1, 0, 0, 0] },
      })
    })

    expect(mesh.getAttribute('position')).toBe('2,0.5,0.1')
  })
})
