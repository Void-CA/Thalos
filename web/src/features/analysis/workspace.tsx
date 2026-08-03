import { useState } from 'react'
import { useAnalysisStore, useSelectedRegion } from './store'
import { planAnalysisApi } from './api/plan-analysis-api'
import { StatusBanner } from './components/status-banner'
import { ProblemRegions } from './components/problem-regions'
import { RegionInspector } from './components/region-inspector'
import { OptimizationPanel } from './components/optimization-panel'
import { useSceneStore } from '@/features/viewport/store'

import { ChartBar, Loader2, ChevronRight } from 'lucide-react'

/**
 * AnalysisWorkspace — layout del workspace Analysis.
 *
 * Matching Angular analysis-workspace.ts con:
 *   - Breadcrumb (location only — no cross-workspace back button, slice 5)
 *   - StatusBanner
 *   - ProblemRegions (overview) / RegionInspector (deep inspection)
 *   - AlternativesPanel
 *
 * The breadcrumb shows the current location; the ONLY back control is the
 * intra-workspace region drill-down (selectRegion). Cross-workspace navigation
 * lives in the global stepper + top-bar (registry-driven).
 */
export function AnalysisWorkspace() {
  const hasPlan = useSceneStore(s => s.activePlan !== null)
  const summary = useAnalysisStore(s => s.summary)
  const setAnalysis = useAnalysisStore(s => s.setAnalysis)
  const selectedRegion = useSelectedRegion()
  const hasAnalysis = summary !== null

  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const res = await planAnalysisApi.analyze()
      setAnalysis(res)
    } catch (err: any) {
      setError(err.message ?? 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Breadcrumb — current location; intra-workspace drill-down back only */}
      <nav className="flex items-center gap-1.5 px-4 py-2 border-b border-border text-xs text-muted-foreground shrink-0">
        {selectedRegion ? (
          <>
            <button onClick={() => useAnalysisStore.getState().selectRegion(null)} className="hover:text-foreground transition-colors cursor-pointer">
              Analysis
            </button>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">
              {selectedRegion.severity === 'critical' || selectedRegion.severity === 'error' ? 'Critical' : selectedRegion.severity === 'warning' ? 'Warning' : 'Info'}
            </span>
          </>
        ) : (
          <span className="text-foreground font-medium">Analysis</span>
        )}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!hasPlan && !hasAnalysis && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ChartBar className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No plan compiled</p>
            <p className="text-xs mt-1 opacity-60">
              Compile a plan in <strong>Planning</strong> to start analysis.
            </p>
          </div>
        )}

        {hasPlan && !hasAnalysis && !analyzing && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm mb-3">This plan has not been analyzed yet.</p>
            <button
              onClick={handleAnalyze}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                         border border-primary-mid bg-primary-weak text-primary
                         hover:bg-primary-weak transition-all cursor-pointer"
            >
              <ChartBar className="h-4 w-4" />
              Analyze Plan
            </button>
          </div>
        )}

        {analyzing && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Analyzing…</span>
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive-weak border border-destructive-weak rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {hasAnalysis && (
          <>
            <StatusBanner />

            {selectedRegion ? (
              <RegionInspector />
              ) : (
                <>
                  <ProblemRegions />
                  <OptimizationPanel />
                </>
              )}
          </>
        )}
      </div>
    </div>
  )
}
