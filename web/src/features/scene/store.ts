import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { PoseDef, SceneContent, TaskDocument, DocMetadata, SemanticOp } from '@/shared/contracts'

export interface SceneObject {
  id: string
  name: string
  pose: PoseDef
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

  addObject: (obj: SceneObject) => void
  removeObject: (id: string) => void
  updateObject: (id: string, obj: Partial<SceneObject>) => void

  addLocation: (loc: SceneLocation) => void
  removeLocation: (id: string) => void
  updateLocation: (id: string, loc: Partial<SceneLocation>) => void

  addTool: (tool: SceneTool) => void
  removeTool: (id: string) => void

  setHomePose: (pose: PoseDef) => void

  /** Build a TaskDocument from the current scene + operations */
  toTaskDocument: (operations: SemanticOp[]) => TaskDocument
}

// SCARA FK([0,0,0,0]) = [1.8, 0.0, 0.5]
// Mantener home_pose en FK([0,0,0,0]) para que IK converja al inicio
const defaultPose: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

// Canonical SCARA scene — seeded so a fresh Task is immediately runnable.
// Values match the SceneEditor "+" handlers so edits behave identically.
const seededObjects: SceneObject[] = [
  { id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } },
]
const seededLocations: SceneLocation[] = [
  { id: 'tray-1', name: 'Tray', pose: { position: [0.8, -0.3, 0], orientation: [0, 0, 0, 1] } },
]

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
      objects: seededObjects.map((o) => ({ ...o })),
      locations: seededLocations.map((l) => ({ ...l })),
      tools: [],
      homePose: { ...defaultPose },

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

      toTaskDocument: (operations) => {
        const s = get()
        const scene: SceneContent = {
          objects: s.objects.map((o) => ({
            id: o.id,
            name: o.name,
            pose: o.pose,
            category: null,
          })),
          locations: s.locations.map((l) => ({
            id: l.id,
            name: l.name,
            pose: l.pose,
            description: null,
          })),
          tools: s.tools.map((t) => ({ id: t.id, name: t.name })),
          home_pose: s.homePose,
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
