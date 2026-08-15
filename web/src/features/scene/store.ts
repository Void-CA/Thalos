import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  PoseDef, SceneContent, TaskDocument, DocMetadata, SemanticOp,
  SceneFile, RobotRef, GeometryDef,
} from '@/shared/contracts'

export interface SceneObject {
  id: string
  name: string
  pose: PoseDef
  /** Semantic category (SceneFile `kind`, e.g. "bolt") — preserved for
   *  SceneFile round-trip (D4 web-side: feeds TaskDocument `category`). */
  kind?: string | null
  /** VISUALIZATION-ONLY geometry (SceneFile v1) — preserved for round-trip. */
  geometry?: GeometryDef | null
}

export interface SceneLocation {
  id: string
  name: string
  pose: PoseDef
}

export interface SceneTool {
  id: string
  name: string
}

interface SceneState {
  objects: SceneObject[]
  locations: SceneLocation[]
  tools: SceneTool[]
  homePose: PoseDef
  /** SCARA approach/retreat transit height (metres) — always-on for MVP. */
  approachHeight: number
  /** Robot loaded from a SceneFile (D11 `name` stable identity; D14 read-only
   *  display). `null` until a scene file is loaded — the seeded editor has no
   *  persisted robot ref. */
  robot: RobotRef | null

  addObject: (obj: SceneObject) => void
  removeObject: (id: string) => void
  updateObject: (id: string, obj: Partial<SceneObject>) => void

  addLocation: (loc: SceneLocation) => void
  removeLocation: (id: string) => void
  updateLocation: (id: string, loc: Partial<SceneLocation>) => void

  addTool: (tool: SceneTool) => void
  removeTool: (id: string) => void

  setHomePose: (pose: PoseDef) => void
  setApproachHeight: (height: number) => void

  /** Hydrate the scene from a SceneFile — fully REPLACES prior state (no
   *  merge/accumulate; demos-workspace spec "State Invariants"). Objects map
   *  with `name` falling back to `id` (D4); tools are cleared (a SceneFile has
   *  none); fixtures are NOT carried into the domain store (presentational).
   *  Never touches the semantic editor (Load Scene ≠ Load Program). */
  loadSceneFile: (file: SceneFile) => void
  /** Export the current scene as a SceneFile v1 for [Save Scene] (D12 browser
   *  download). Inverse of `loadSceneFile` on every carried field. */
  serializeSceneFile: () => SceneFile

  /** Build a TaskDocument from the current scene + operations */
  toTaskDocument: (operations: SemanticOp[]) => TaskDocument
}

// SCARA FK([0,0,0,0]) = [1.8, 0.0, 0.5]
// Mantener home_pose en FK([0,0,0,0]) para que IK converja al inicio
const defaultPose: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

// Canonical SCARA scene — seeded so a fresh Task is immediately runnable.
// Design D6: SEEDED_OBJECTS/SEEDED_LOCATIONS and the add-handler defaults are
// a SINGLE source of truth — the seeds derive from the default poses, and the
// SceneEditor "+" handlers import the same constants (no duplicate literals).
// Orientation is the identity quaternion `[w,x,y,z] = [1,0,0,0]` (spec R3),
// matching the backend RotationDto::Quaternion wire format.
export const defaultObjectPose: PoseDef = { position: [1.8, 0, 0.4], orientation: [1, 0, 0, 0] }
export const defaultLocationPose: PoseDef = { position: [0.8, -0.3, 0], orientation: [1, 0, 0, 0] }

export const SEEDED_OBJECTS: SceneObject[] = [
  { id: 'bolt-1', name: 'Bolt', pose: { ...defaultObjectPose } },
]
export const SEEDED_LOCATIONS: SceneLocation[] = [
  { id: 'tray-1', name: 'Tray', pose: { ...defaultLocationPose } },
]

/** Default SCARA approach height (m) — matches the backend serde default. */
export const DEFAULT_APPROACH_HEIGHT = 0.05

/**
 * Domain scene store (design D4, area-scene spec "Scene Store Renamed").
 *
 * Represents the Scene DOMAIN ARTIFACT (objects/locations/tools/homePose),
 * not a widget: renamed from the semantic `useSceneStore` to
 * `useDomainSceneStore` so it never collides with the viewport's
 * `useSceneStore` (3D scene state). Task consumes this store as the Scene
 * artifact (`toTaskDocument`) but the Scene area is its only editor.
 * This module imports NO Task feature code (C4: Scene never knows Task).
 */
export const useDomainSceneStore = create<SceneState>()(
  devtools(
    (set, get) => ({
      objects: SEEDED_OBJECTS.map((o) => ({ ...o })),
      locations: SEEDED_LOCATIONS.map((l) => ({ ...l })),
      tools: [],
      homePose: { ...defaultPose },
      approachHeight: DEFAULT_APPROACH_HEIGHT,
      robot: null,

      addObject: (obj) => set((s) => ({ objects: [...s.objects, obj] })),
      removeObject: (id) =>
        set((s) => ({ objects: s.objects.filter((o) => o.id !== id) })),
      updateObject: (id, partial) =>
        set((s) => ({
          objects: s.objects.map((o) =>
            o.id === id ? { ...o, ...partial } : o,
          ),
        })),

      addLocation: (loc) => set((s) => ({ locations: [...s.locations, loc] })),
      removeLocation: (id) =>
        set((s) => ({ locations: s.locations.filter((l) => l.id !== id) })),
      updateLocation: (id, partial) =>
        set((s) => ({
          locations: s.locations.map((l) =>
            l.id === id ? { ...l, ...partial } : l,
          ),
        })),

      addTool: (tool) => set((s) => ({ tools: [...s.tools, tool] })),
      removeTool: (id) =>
        set((s) => ({ tools: s.tools.filter((t) => t.id !== id) })),

      setHomePose: (pose) => set({ homePose: pose }),

      setApproachHeight: (height) => set({ approachHeight: height }),

      loadSceneFile: (file) =>
        set({
          objects: file.objects.map((o) => ({
            id: o.id,
            // D4: name falls back to the id — same rule as the backend mapping.
            name: o.name ?? o.id,
            pose: o.pose,
            kind: o.kind,
            geometry: o.geometry ?? null,
          })),
          locations: file.locations.map((l) => ({
            id: l.id,
            // The file format has no location name — falls back to the id (D4).
            name: l.id,
            pose: l.pose,
          })),
          // A SceneFile carries no tools (backend mapping: `tools: Vec::new()`);
          // full replacement clears whatever the prior scene held.
          tools: [],
          homePose: { ...file.home_pose },
          approachHeight: file.approach_height,
          robot: { name: file.robot.name, urdf: file.robot.urdf },
        }),

      serializeSceneFile: () => {
        const s = get()
        return {
          schema_version: '1',
          robot: s.robot ?? { name: '', urdf: '' },
          objects: s.objects.map((o) => ({
            id: o.id,
            kind: o.kind ?? 'object',
            // Emit `name` only when it differs from the id — mirrors the file
            // format's optional label and keeps load→save round-trips exact.
            ...(o.name !== o.id ? { name: o.name } : {}),
            ...(o.geometry ? { geometry: o.geometry } : {}),
            pose: o.pose,
          })),
          // D4: fixtures are presentational — the domain store does not carry
          // them; Save emits an empty list (Git remains the source of truth).
          fixtures: [],
          locations: s.locations.map((l) => ({
            id: l.id,
            kind: 'placement_target',
            pose: l.pose,
          })),
          home_pose: s.homePose,
          approach_height: s.approachHeight,
        }
      },

      toTaskDocument: (operations) => {
        const s = get()
        const scene: SceneContent = {
          objects: s.objects.map((o) => ({
            id: o.id,
            name: o.name,
            pose: o.pose,
            // D4 web-side: SceneFile `kind` → TaskDocument `category`
            // (mirrors the backend `into_scene_content` mapping).
            category: o.kind ?? null,
          })),
          locations: s.locations.map((l) => ({
            id: l.id,
            name: l.name,
            pose: l.pose,
            description: null,
          })),
          tools: s.tools.map((t) => ({ id: t.id, name: t.name })),
          home_pose: s.homePose,
          approach_height: s.approachHeight,
        }
        const metadata: DocMetadata = {
          name: 'Task',
          version: 1,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
        }
        return {
          id: crypto.randomUUID?.() ?? `${Date.now()}`,
          metadata,
          scene,
          program: { operations },
        }
      },
    }),
    { name: 'domain-scene' },
  ),
)

/**
 * Structural SceneFile guard for the local file picker (D12). The web loads
 * files the backend would ALSO parse — the backend does the authoritative
 * tier (a)/(b) validation, so this stays deliberately shallow: reject anything
 * that is not a plausible SceneFile v1 document before it reaches
 * `loadSceneFile`. Pure — unit-testable without a DOM.
 */
export function isSceneFile(value: unknown): value is SceneFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const robot = v.robot as Record<string, unknown> | null
  return (
    v.schema_version === '1' &&
    typeof robot === 'object' &&
    robot !== null &&
    typeof robot.name === 'string' &&
    typeof robot.urdf === 'string' &&
    Array.isArray(v.objects) &&
    Array.isArray(v.fixtures) &&
    Array.isArray(v.locations) &&
    typeof v.home_pose === 'object' &&
    v.home_pose !== null &&
    typeof v.approach_height === 'number'
  )
}
