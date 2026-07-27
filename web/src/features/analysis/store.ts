import { create } from 'zustand'
import type { WaypointAnalysisDto, PlanAnalysisResponse } from './api/plan-analysis.types'

export interface ProblemRegion {
  id: number
  kind: string
  severity: string
  waypoint_start: number
  waypoint_end: number
  waypoint_count: number
  metrics?: {
    waypoint_count: number
    average_value: number | null
    min_value: number | null
    max_value: number | null
    error_count: number
    warning_count: number
  } | null
  explanation?: {
    cause: string
    consequence: string
    recommended_strategies: string[]
    confidence: number
  } | null
  recommended_strategies?: string[]
}

export interface Finding {
  kind: string
  severity: 'info' | 'warning' | 'error'
  waypoint: number | null
  message: string
  value: number | null
}

export interface Recommendation {
  kind: string
  message: string
  impact: 'low' | 'medium' | 'high'
  waypoint: number | null
}

interface AnalysisState {
  waypoints: WaypointAnalysisDto[]
  summary: PlanAnalysisResponse['summary'] | null
  metrics: PlanAnalysisResponse['metrics'] | null
  findings: Finding[]
  recommendations: Recommendation[]
  problemRegions: ProblemRegion[]
  healthScore: number | null
  selectedRegionId: number | null
  loading: boolean
  error: string | null

  setAnalysis: (res: PlanAnalysisResponse) => void
  selectRegion: (id: number | null) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
  clear: () => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  waypoints: [],
  summary: null,
  metrics: null,
  findings: [],
  recommendations: [],
  problemRegions: [],
  healthScore: null,
  selectedRegionId: null,
  loading: false,
  error: null,

  setAnalysis: (res) => set({
    waypoints: res.waypoints ?? [],
    summary: res.summary ?? null,
    metrics: res.metrics ?? null,
    findings: (res.findings ?? []) as Finding[],
    recommendations: (res.recommendations ?? []) as Recommendation[],
    problemRegions: (res.problem_regions ?? []) as ProblemRegion[],
    healthScore: res.health_score ?? null,
    loading: false,
    error: null,
    selectedRegionId: null,
  }),

  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  clear: () => set({
    waypoints: [], summary: null, metrics: null,
    findings: [], recommendations: [], problemRegions: [],
    healthScore: null, selectedRegionId: null,
    loading: false, error: null,
  }),
}))

/** Computed: la región seleccionada (o null). */
export const useSelectedRegion = () => {
  const id = useAnalysisStore(s => s.selectedRegionId)
  const regions = useAnalysisStore(s => s.problemRegions)
  if (id === null) return null
  return regions.find(r => r.id === id) ?? null
}
