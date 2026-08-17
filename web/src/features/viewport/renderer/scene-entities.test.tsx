// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { SceneEntities, ENTITY_SIZE, LABEL_OFFSET } from './scene-entities'
import { useDomainSceneStore, SEEDED_OBJECTS, SEEDED_LOCATIONS } from '@/features/scene/store'
import type { SceneObject, SceneLocation } from '@/features/scene/store'

/**
 * Scene viewport entities (scene-viewport-entities spec, PR-4 + Z-up delta):
 *
 * - R1: entities from useDomainSceneStore render as meshes at world coords
 *   with name labels.
 * - R2: empty store → renders null, no error.
 * - R1.3: editing a pose re-renders the mesh (live store subscription).
 * - Z-up delta: location cylinders rotate π/2 about X to lie flat on the XY
 *   plane; labels anchor above the entity via `[0, 0, LABEL_OFFSET]`; a
 *   location at z=0 is nudged to `z = ENTITY_SIZE/2` to avoid floor
 *   intersection; store seeds must stay unchanged.
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
// label children as plain DOM and surfaces the declared `position` prop as an
// attribute so the Z-up label contract is assertable.
vi.mock('@react-three/drei', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/drei')>()
  return {
    ...actual,
    Html: ({ children, position }: { children?: React.ReactNode; position?: [number, number, number] }) => (
      <div data-label-pos={position ? position.join(',') : undefined}>{children}</div>
    ),
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

/** Location ABOVE the floor — z-nudge must NOT apply (only z=0 nudges). */
const raisedTrayAt: SceneLocation = {
  id: 'tray-2',
  name: 'Tray Raised',
  pose: { position: [0.8, -0.3, 0.5], orientation: [1, 0, 0, 0] },
}

/** Location with a NON-IDENTITY orientation (180° about Z, store [w,x,y,z]) —
 *  the R3-002 regression: a separate `rotation` prop used to discard it. */
const tiltedTrayAt: SceneLocation = {
  id: 'tray-3',
  name: 'Tray Tilted',
  pose: { position: [0.8, -0.3, 0.5], orientation: [0, 0, 0, 1] },
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

  it('renders a location mesh flat on XY with a Z-up label and z-nudge at z=0 (R1.2 + Z-up delta)', () => {
    act(() => {
      useDomainSceneStore.setState({ locations: [trayAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-tray-1')
    expect(mesh).toBeInTheDocument()
    // z-nudge: tray seed z=0 → ENTITY_SIZE/2 (sits on the floor, no intersection)
    expect(mesh.getAttribute('position')).toBe(`0.8,-0.3,${ENTITY_SIZE / 2}`)
    // R3-002: the π/2 flat-lay is composed INTO the quaternion (q_π2_x × identity
    // = q_π2_x) — a single transform, so no separate rotation prop remains.
    expect(mesh.getAttribute('quaternion')).toBe(`${Math.SQRT1_2},0,0,${Math.SQRT1_2}`)
    expect(mesh.getAttribute('rotation')).toBeNull()
    expect(screen.getByText('Tray')).toBeInTheDocument()
  })
})

describe('SceneEntities — tolerates an empty store (R2)', () => {
  it('anchors labels above the entity with a Z-up offset [0,0,LABEL_OFFSET] (Z-up delta)', () => {
    act(() => {
      useDomainSceneStore.setState({ objects: [boltAt], locations: [trayAt] })
    })
    render(<SceneEntities />)
    // Both kinds (object + location) label above, never sideways in Z-up.
    const boltLabel = screen.getByText('Bolt').parentElement as HTMLElement
    expect(boltLabel).toHaveAttribute('data-label-pos', `0,0,${LABEL_OFFSET}`)
    const trayLabel = screen.getByText('Tray').parentElement as HTMLElement
    expect(trayLabel).toHaveAttribute('data-label-pos', `0,0,${LABEL_OFFSET}`)
  })

  it('nudges only locations at z=0 — a raised location keeps its z (Z-up delta)', () => {
    act(() => {
      useDomainSceneStore.setState({ locations: [raisedTrayAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-tray-2')
    expect(mesh.getAttribute('position')).toBe('0.8,-0.3,0.5')
    expect(mesh.getAttribute('quaternion')).toBe(`${Math.SQRT1_2},0,0,${Math.SQRT1_2}`)
    expect(mesh.getAttribute('rotation')).toBeNull()
  })

  it('preserves a non-identity location orientation composed with the flat-lay rotation (R3-002)', () => {
    act(() => {
      useDomainSceneStore.setState({ locations: [tiltedTrayAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-tray-3')
    // locationQuaternion(pose) = q_π2_x ⊗ q_pose with q_pose = 180° about Z
    // → [x,y,z,w] = [0, -√2/2, √2/2, 0]. The mesh must carry this SINGLE
    // quaternion — a separate rotation prop would overwrite pose.orientation.
    expect(mesh.getAttribute('quaternion')).toBe(
      `0,${-Math.SQRT1_2},${Math.SQRT1_2},0`,
    )
    expect(mesh.getAttribute('rotation')).toBeNull()
  })

  it('re-nudges a location edited to z=0 (R1.3 + Z-up delta)', () => {
    act(() => {
      useDomainSceneStore.setState({ locations: [raisedTrayAt] })
    })
    render(<SceneEntities />)
    const mesh = screen.getByTestId('scene-entity-mesh-tray-2')
    expect(mesh.getAttribute('position')).toBe('0.8,-0.3,0.5')

    act(() => {
      useDomainSceneStore.getState().updateLocation('tray-2', {
        pose: { position: [0.8, -0.3, 0], orientation: [1, 0, 0, 0] },
      })
    })

    expect(mesh.getAttribute('position')).toBe(`0.8,-0.3,${ENTITY_SIZE / 2}`)
  })

  it('keeps the scene store seeds Z-up consistent and unchanged (Seed values unchanged)', () => {
    expect(SEEDED_OBJECTS[0].pose.position).toEqual([1.8, 0, 0.4])
    expect(SEEDED_LOCATIONS[0].pose.position).toEqual([0.8, -0.3, 0])
  })

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

describe('SceneEntities — approach/retreat markers follow approachHeight (phantom-parameter fix)', () => {
  it('renders approach + retreat markers at entity Z + approachHeight for an object', () => {
    act(() => {
      useDomainSceneStore.setState({ objects: [boltAt], approachHeight: 0.05 })
    })
    render(<SceneEntities />)
    const approach = screen.getByTestId('approach-marker-bolt-1')
    const retreat = screen.getByTestId('retreat-marker-bolt-1')
    expect(approach).toBeInTheDocument()
    expect(retreat).toBeInTheDocument()
    // bolt z=0.5 (object, no z-nudge) + approachHeight 0.05
    expect(approach.getAttribute('position')).toBe('1.5,0.3,0.55')
    expect(retreat.getAttribute('position')).toBe('1.5,0.3,0.55')
  })

  it('aligns location markers with the z-nudged mesh (z=0 → ENTITY_SIZE/2 + approachHeight)', () => {
    act(() => {
      useDomainSceneStore.setState({ locations: [trayAt], approachHeight: 0.05 })
    })
    render(<SceneEntities />)
    const approach = screen.getByTestId('approach-marker-tray-1')
    // tray z=0 is nudged to ENTITY_SIZE/2 like the mesh, marker sits above it
    expect(approach.getAttribute('position')).toBe(`0.8,-0.3,${ENTITY_SIZE / 2 + 0.05}`)
  })

  it('re-renders markers at the new Z after setApproachHeight', () => {
    act(() => {
      useDomainSceneStore.setState({ objects: [boltAt], approachHeight: 0.05 })
    })
    render(<SceneEntities />)
    const approach = screen.getByTestId('approach-marker-bolt-1')
    expect(approach.getAttribute('position')).toBe('1.5,0.3,0.55')

    act(() => {
      useDomainSceneStore.getState().setApproachHeight(0.1)
    })

    expect(approach.getAttribute('position')).toBe('1.5,0.3,0.6')
  })

  it('renders no markers when approachHeight is 0', () => {
    act(() => {
      useDomainSceneStore.setState({ objects: [boltAt], approachHeight: 0 })
    })
    render(<SceneEntities />)
    expect(screen.queryByTestId('approach-marker-bolt-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('retreat-marker-bolt-1')).not.toBeInTheDocument()
  })
})
