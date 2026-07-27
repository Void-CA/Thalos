import { usePerspectiveStore } from '@/shared/layout/perspective-store'
import { PlanningPanel } from './components/planning-panel'
import { TrajectoryColorPicker } from './components/trajectory-color-picker'

/**
 * PlanningWorkspace — layout del workspace Planning.
 *
 * Matching Angular planning-workspace.ts:
 *   - Motion Program (scroll)
 *   - Trajectory Color selector
 *   - Analyze button → navega a Analysis
 */
export function PlanningWorkspace() {
  const setPerspective = usePerspectiveStore(s => s.setPerspective)

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

        {/* Analyze button */}
        <button
          onClick={() => setPerspective('analysis')}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium
                     rounded-lg border border-amber-600/30 bg-amber-950/20 text-amber-500
                     hover:bg-amber-950/30 hover:border-amber-600/50
                     transition-all cursor-pointer"
        >
          Analyze trajectory
        </button>
      </div>
    </div>
  )
}
