import { describe, it, expect, beforeEach } from 'vitest'
import {
  useDomainSceneStore,
  SEEDED_OBJECTS,
  SEEDED_LOCATIONS,
  defaultObjectPose,
  defaultLocationPose,
  DEFAULT_APPROACH_HEIGHT,
  isSceneFile,
} from './store'
import { useSemanticEditor } from '@/features/semantic/store'
import type { PoseDef, SceneFile } from '@/shared/contracts'

const seedHome: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

/** Golden SceneFile v1 — mirrors the backend `scene_file.rs` sample: mixed
 *  objects (one with geometry, one without), a fixture, one location, and a
 *  non-default robot ref. `serializeSceneFile` must round-trip every field the
 *  domain store carries (D4: fixtures are presentational → dropped). */
const GOLDEN_SCENE_FILE: SceneFile = {
  schema_version: '1',
  robot: { name: 'icebot', urdf: 'docs/robot/icebot.urdf' },
  objects: [
    {
      id: 'box-1',
      kind: 'box',
      name: 'Box 1',
      geometry: { type: 'box', size: [0.1, 0.1, 0.1] },
      pose: { position: [0.2, 0.1, 0.0], orientation: [0.0, 0.0, 0.0, 1.0] },
    },
    {
      id: 'bolt-1',
      kind: 'bolt',
      pose: { position: [0.15, -0.1, 0.02], orientation: [0.0, 0.0, 0.0, 1.0] },
    },
  ],
  fixtures: [
    {
      id: 'fence-1',
      geometry: { type: 'box', size: [0.5, 0.02, 0.3] },
      pose: { position: [0.4, 0.0, 0.0], orientation: [0.0, 0.0, 0.0, 1.0] },
    },
  ],
  locations: [
    {
      id: 'tray-1',
      kind: 'placement_target',
      pose: { position: [0.3, -0.2, 0.0], orientation: [0.0, 0.0, 0.0, 1.0] },
    },
  ],
  home_pose: { position: [0.0, 0.0, 0.5], orientation: [0.0, 0.0, 0.0, 1.0] },
  approach_height: 0.05,
}

function resetToCanonicalSeed() {
  useDomainSceneStore.setState({
    objects: SEEDED_OBJECTS.map((o) => ({ ...o })),
    locations: SEEDED_LOCATIONS.map((l) => ({ ...l })),
    tools: [],
    homePose: { ...seedHome },
    approachHeight: DEFAULT_APPROACH_HEIGHT,
    robot: null,
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

describe('loadSceneFile — hydrate from a SceneFile (demos-workspace spec, D12/D13)', () => {
  it('fully REPLACES objects/locations/tools/homePose/approachHeight/robot — no stale state', () => {
    useDomainSceneStore.getState().loadSceneFile(GOLDEN_SCENE_FILE)
    const s = useDomainSceneStore.getState()
    // Seeded SCARA objects are gone — nothing from the prior scene survives.
    expect(s.objects.map((o) => o.id)).toEqual(['box-1', 'bolt-1'])
    expect(s.locations.map((l) => l.id)).toEqual(['tray-1'])
    expect(s.tools).toEqual([])
    expect(s.homePose).toEqual(GOLDEN_SCENE_FILE.home_pose)
    expect(s.approachHeight).toBe(0.05)
    expect(s.robot).toEqual({ name: 'icebot', urdf: 'docs/robot/icebot.urdf' })
  })

  it('maps objects 1:1 with name fallback to id and preserves kind/geometry (D4)', () => {
    useDomainSceneStore.getState().loadSceneFile(GOLDEN_SCENE_FILE)
    const [boxed, bolt] = useDomainSceneStore.getState().objects
    expect(boxed).toEqual({
      id: 'box-1',
      name: 'Box 1',
      pose: GOLDEN_SCENE_FILE.objects[0].pose,
      kind: 'box',
      geometry: { type: 'box', size: [0.1, 0.1, 0.1] },
    })
    // No name in the file → falls back to the id; no geometry → null.
    expect(bolt).toEqual({
      id: 'bolt-1',
      name: 'bolt-1',
      pose: GOLDEN_SCENE_FILE.objects[1].pose,
      kind: 'bolt',
      geometry: null,
    })
    // D4 web-side: kind feeds TaskDocument category (backend maps kind→category).
    const doc = useDomainSceneStore.getState().toTaskDocument([])
    expect(doc.scene.objects[0].category).toBe('box')
  })

  it('hydrates locations with name fallback to id', () => {
    useDomainSceneStore.getState().loadSceneFile(GOLDEN_SCENE_FILE)
    expect(useDomainSceneStore.getState().locations[0]).toEqual({
      id: 'tray-1',
      name: 'tray-1',
      pose: GOLDEN_SCENE_FILE.locations[0].pose,
    })
  })

  it('leaves the semantic editor operations untouched (demos-workspace "Load scene only")', () => {
    useSemanticEditor.getState().reset()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    useDomainSceneStore.getState().loadSceneFile(GOLDEN_SCENE_FILE)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(useSemanticEditor.getState().dirty).toBe(0)
  })
})

describe('serializeSceneFile — scene → SceneFile export (D12 browser download)', () => {
  it('round-trips every carried field of the loaded file (golden-style)', () => {
    useDomainSceneStore.getState().loadSceneFile(GOLDEN_SCENE_FILE)
    const out = useDomainSceneStore.getState().serializeSceneFile()
    expect(out.schema_version).toBe('1')
    expect(out.robot).toEqual(GOLDEN_SCENE_FILE.robot)
    // name emitted only when it differs from the id (mirrors the file format).
    expect(out.objects[0]).toEqual(GOLDEN_SCENE_FILE.objects[0])
    expect(out.objects[1]).toEqual({
      id: 'bolt-1',
      kind: 'bolt',
      pose: GOLDEN_SCENE_FILE.objects[1].pose,
    })
    expect(out.locations).toEqual(GOLDEN_SCENE_FILE.locations)
    expect(out.home_pose).toEqual(GOLDEN_SCENE_FILE.home_pose)
    expect(out.approach_height).toBe(GOLDEN_SCENE_FILE.approach_height)
    // D4: fixtures are presentational, not carried by the domain store.
    expect(out.fixtures).toEqual([])
  })

  it('load → save → load is idempotent: hydration state is stable', () => {
    useDomainSceneStore.getState().loadSceneFile(GOLDEN_SCENE_FILE)
    const first = useDomainSceneStore.getState()
    const snapshot = {
      objects: first.objects,
      locations: first.locations,
      tools: first.tools,
      homePose: first.homePose,
      approachHeight: first.approachHeight,
      robot: first.robot,
    }
    const out = useDomainSceneStore.getState().serializeSceneFile()
    useDomainSceneStore.getState().loadSceneFile(out)
    const second = useDomainSceneStore.getState()
    expect(second.objects).toEqual(snapshot.objects)
    expect(second.locations).toEqual(snapshot.locations)
    expect(second.tools).toEqual(snapshot.tools)
    expect(second.homePose).toEqual(snapshot.homePose)
    expect(second.approachHeight).toBe(snapshot.approachHeight)
    expect(second.robot).toEqual(snapshot.robot)
  })
})

describe('isSceneFile — local-file guard (D12 local picker, invalid-file errors)', () => {
  it('accepts a structurally valid SceneFile', () => {
    expect(isSceneFile(GOLDEN_SCENE_FILE)).toBe(true)
  })

  it('rejects non-objects and non-SceneFile JSON payloads', () => {
    expect(isSceneFile(null)).toBe(false)
    expect(isSceneFile({ schema_version: '1' })).toBe(false)
    expect(isSceneFile({ schema_version: '99', robot: {}, objects: [], fixtures: [], locations: [] })).toBe(false)
  })

  it('accepts the minimal valid SceneFile (objects/fixtures/locations may be empty)', () => {
    expect(isSceneFile({ ...GOLDEN_SCENE_FILE, objects: [], fixtures: [], locations: [] })).toBe(true)
  })
})
