import { create } from 'zustand'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

export type {
  AnalysisReportWire,
  ProblemRegionWire,
  AnalysisObservationWire,
  AnalysisActionWire,
} from '@/shared/contracts/analysis-report'

/**
 * Analysis store — holds ONLY the canonical `AnalysisReportWire` (I4: the
 * store persists a single canonical contract; views derive their shapes
 * locally with pure functions, never a second persisted model).
 *
 * `selectedRegionId` is UI drill-down state (intra-workspace navigation), not
 * domain state.
 */
interface AnalysisState {
  report: AnalysisReportWire | null
  selectedRegionId: number | null
  loading: boolean
  error: string | null

  setAnalysis: (report: AnalysisReportWire) => void
  selectRegion: (id: number | null) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
  clear: () => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  report: null,
  selectedRegionId: null,
  loading: false,
  error: null,

  setAnalysis: (report) => set({
    report,
    loading: false,
    error: null,
    selectedRegionId: null,
  }),

  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  clear: () => set({
    report: null,
    selectedRegionId: null,
    loading: false,
    error: null,
  }),
}))

/** Computed: the selected region (or null). Pure derivation from the report.
 *  NOTE: the selector returns `report` (a stable state reference), never
 *  `report?.problem_regions ?? []` — a fresh array identity per evaluation
 *  would trip Zustand's useSyncExternalStore infinite-loop guard. */
export const useSelectedRegion = () => {
  const id = useAnalysisStore(s => s.selectedRegionId)
  const report = useAnalysisStore(s => s.report)
  const regions = report?.problem_regions ?? []
  if (id === null) return null
  return regions.find(r => r.id === id) ?? null
}
