import { describe, it, expect, beforeEach } from 'vitest'
import {
  useDomainSceneStore,
  SEEDED_OBJECTS,
  SEEDED_LOCATIONS,
  defaultObjectPose,
  defaultLocationPose,
  DEFAULT_APPROACH_HEIGHT,
} from './store'
import type { PoseDef } from '@/shared/contracts'

const seedHome: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

function resetToCanonicalSeed() {
  useDomainSceneStore.setState({
    objects: SEEDED_OBJECTS.map((o) => ({ ...o })),
    locations: SEEDED_LOCATIONS.map((l) => ({ ...l })),
    tools: [],
    homePose: { ...seedHome },
    approachHeight: DEFAULT_APPROACH_HEIGHT,
  })
}

beforeEach(() => resetToCanonicalSeed())

describe('seed constants (design D6 — single source of truth)', () => {
  it('exports SEEDED_OBJECTS with the canonical bolt (spec R3: bolt_pose)', () => {
    expect(SEEDED_OBJECTS).toEqual([
      { id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [1, 0, 0, 0] } },
    ])
  })

  it('exports SEEDED_LOCATIONS with the canonical tray', () => {
    expect(SEEDED_LOCATIONS).toEqual([
      { id: 'tray-1', name: 'Tray', pose: { position: [0.8, -0.3, 0], orientation: [1, 0, 0, 0] } },
    ])
  })

  it('defaultObjectPose/defaultLocationPose match the seed poses — no duplicate literals', () => {
    expect(defaultObjectPose).toEqual(SEEDED_OBJECTS[0].pose)
    expect(defaultLocationPose).toEqual(SEEDED_LOCATIONS[0].pose)
  })
})

describe('scene store state', () => {
  it('initializes objects/locations from the seeded constants', () => {
    const s = useDomainSceneStore.getState()
    expect(s.objects[0].pose).toEqual(SEEDED_OBJECTS[0].pose)
    expect(s.locations[0].pose).toEqual(SEEDED_LOCATIONS[0].pose)
  })

  it('stores a new object created with the default pose (R2/R3)', () => {
    useDomainSceneStore
      .getState()
      .addObject({ id: 'obj-2', name: 'Object 2', pose: { ...defaultObjectPose } })
    const added = useDomainSceneStore.getState().objects.find((o) => o.id === 'obj-2')
    expect(added?.pose).toEqual(defaultObjectPose)
  })

  it('toTaskDocument keeps the scene structure unchanged (task 3.6)', () => {
    const doc = useDomainSceneStore.getState().toTaskDocument([])
    expect(doc.scene.objects[0]).toEqual({
      id: 'bolt-1',
      name: 'Bolt',
      pose: SEEDED_OBJECTS[0].pose,
      category: null,
    })
    expect(doc.scene.locations[0]).toEqual({
      id: 'tray-1',
      name: 'Tray',
      pose: SEEDED_LOCATIONS[0].pose,
      description: null,
    })
    expect(doc.scene.tools).toEqual([])
    expect(doc.scene.home_pose).toEqual(seedHome)
    expect(doc.scene.approach_height).toBe(DEFAULT_APPROACH_HEIGHT)
  })

  it('setApproachHeight updates the serialized SCARA approach height', () => {
    useDomainSceneStore.getState().setApproachHeight(0.12)
    const doc = useDomainSceneStore.getState().toTaskDocument([])
    expect(doc.scene.approach_height).toBe(0.12)
  })
})
