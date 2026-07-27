import { create } from 'zustand'

/** Punto con posición y metadatos opcionales según el origen. */
export interface CloudPoint {
  position: [number, number, number]
  /** Solo disponible en samples de singularity. */
  state?: string
  /** Solo disponible en samples de manipulability. */
  yoshikawa?: number
}

export type PointCloudColorMode = 'none' | 'workspace' | 'singularity' | 'manipulability'

interface WorkspaceState {
  /** Samples por tipo de análisis — cada uno tiene los campos que le corresponden. */
  workspaceSamples: CloudPoint[] | null
  singularitySamples: CloudPoint[] | null
  manipulabilitySamples: CloudPoint[] | null

  showPointCloud: boolean
  colorMode: PointCloudColorMode
  loading: boolean
  error: string | null

  setSamples: (type: 'workspace' | 'singularity' | 'manipulability', points: CloudPoint[] | null) => void
  setShowPointCloud: (show: boolean) => void
  setColorMode: (mode: PointCloudColorMode) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaceSamples: null,
  singularitySamples: null,
  manipulabilitySamples: null,
  showPointCloud: false,
  colorMode: 'none',
  loading: false,
  error: null,

  setSamples: (type, points) => {
    const key = type === 'workspace' ? 'workspaceSamples'
      : type === 'singularity' ? 'singularitySamples'
      : 'manipulabilitySamples'
    set({ [key]: points, error: null })
  },

  setShowPointCloud: (showPointCloud) => set({ showPointCloud }),
  setColorMode: (colorMode) => set({ colorMode }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set({
    workspaceSamples: null, singularitySamples: null, manipulabilitySamples: null,
    showPointCloud: false, colorMode: 'none', loading: false, error: null,
  }),
}))
