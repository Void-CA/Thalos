import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { PoseDef, SceneContent, TaskDocument, DocMetadata } from './types'

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
  toTaskDocument: (operations: import('./types').SemanticOp[]) => TaskDocument
}

// SCARA FK([0,0,0,0]) = [1.8, 0.0, 0.5]
// Mantener home_pose en FK([0,0,0,0]) para que IK converja al inicio
const defaultPose: PoseDef = { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] }

export const useSceneStore = create<SceneState>()(
  devtools(
    (set, get) => ({
      objects: [],
      locations: [],
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
    { name: 'scene-editor' },
  ),
)
