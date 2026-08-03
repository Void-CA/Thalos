import { PlanningPanel } from './components/planning-panel'
import { TrajectoryColorPicker } from './components/trajectory-color-picker'
import { AnalysisSection } from '@/features/analysis/analysis-section'

/**
 * PlanningWorkspace — layout del workspace Planning.
 *
 * Matching Angular planning-workspace.ts:
 *   - Motion Program (scroll)
 *   - Trajectory Color selector
 *   - Analysis (absorbed from the legacy /analysis workspace, slice 6)
 *
 * No cross-navigation: the global stepper / top-bar own navigation to other
 * workspaces (slice 5 — "Analyze trajectory" removed; slice 6 — the analysis
 * UI lives here as a plain section instead of a separate workspace).
 */
export function PlanningWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Motion Program */}
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Motion Program
          </h2>
          <PlanningPanel />
        </section>

        {/* Trajectory Color */}
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Trajectory Color
          </h2>
          <TrajectoryColorPicker />
        </section>

        {/* Analysis (absorbed from /analysis — one responsibility per workspace) */}
        <section>
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
            Analysis
          </h2>
          <AnalysisSection />
        </section>
      </div>
    </div>
  )
}
