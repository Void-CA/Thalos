import { create } from 'zustand'

/** Point with position and optional metadata depending on the source. */
export interface CloudPoint {
  position: [number, number, number]
  /** Only available in singularity samples. */
  state?: string
  /** Only available in manipulability samples. */
  yoshikawa?: number
  /** Backend-classified manipulability grade ("low" | "medium" | "high").
   *  Only available in manipulability samples from NEW backends; absent on
   *  legacy payloads → the point-cloud falls back to raw thresholds. */
  grade?: 'low' | 'medium' | 'high'
  /** Percentile score (0–1) of this sample relative to the robot's OWN
   *  normalized-yoshikawa distribution (design "relative_manipulability").
   *  Only available in manipulability samples from NEW backends; absent on
   *  legacy payloads. */
  relativeManipulability?: number
}

export type PointCloudColorMode = 'none' | 'workspace' | 'singularity' | 'manipulability'

interface WorkspaceState {
  /** Samples per analysis type — each one has the fields that correspond to it. */
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
