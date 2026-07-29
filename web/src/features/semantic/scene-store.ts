import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { PoseDef, ResourcePose } from './types'

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

  /** Build resource payload for the compile request */
  toResourcePayload: () => {
    objects: ResourcePose[]
    locations: ResourcePose[]
    home_pose?: PoseDef
  }
}

const defaultPose: PoseDef = { position: [0, 0, 0], orientation: [0, 0, 0, 1] }

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

      toResourcePayload: () => {
        const s = get()
        return {
          objects: s.objects.map((o) => ({ id: o.id, pose: o.pose })),
          locations: s.locations.map((l) => ({ id: l.id, pose: l.pose })),
          home_pose: s.homePose,
        }
      },
    }),
    { name: 'scene-editor' },
  ),
)
