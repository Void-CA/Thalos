import { useNavigate } from 'react-router'
import { useAnalysisStore, useSelectedRegion } from '@/features/analysis/store'
import { StatusBanner } from '@/features/analysis/components/status-banner'
import { ProblemRegions } from '@/features/analysis/components/problem-regions'
import { RegionInspector } from '@/features/analysis/components/region-inspector'
import { RecommendationRow } from '@/features/planning/components/RecommendationRow'
import { useSemanticEditor } from '@/features/semantic/store'
import { useSceneStore } from '@/features/viewport/store'
import { TrajectoryView } from './components/trajectory-view'
import { ShieldCheck } from 'lucide-react'

/**
 * EvaluationWorkspace — the pre-execution EVALUACIÓN (hotfix
 * evaluation-workspace, /evaluation, stage 4).
 *
 * The analysis check STOPS being a tab inside Programación and becomes a
 * VISTA of its own: a "¿estás seguro que querés ejecutar esto?" checkpoint
 * between Programación and Ejecución, with concrete actions instead of an
 * un-actionable dump of up-to-200 observations.
 *
 * Layout + gating decisions:
 *  - Plan summary FIRST: what is about to execute (source Tasks/Motion, plan
 *    id, waypoints, duration, instructions) — the user must see the plan
 *    before deciding.
 *  - Trajectory view: the FULL evaluated trajectory in a lightweight chart
 *    (NOT the R3F viewport — hidden on /evaluation by design), with problem
 *    regions colored by severity and click↔select wiring to the region list.
 *  - Problem regions GROUPED from `problem_regions` (never the raw
 *    observations list): a clean verdict ("no se detectaron problemas") when
 *    the plan has none.
 *  - Repair options + Optimization are HIDDEN (post-MVP): they SHOWED but did
 *    not communicate, and offered no real way to correct the trajectory. The
 *    post-MVP strategy returns a resolved Motion/Task program for the user to
 *    adopt, seeing how the trajectory changes. Code stays in the repo
 *    (AlternativesPanel/OptimizationPanel) unused by this view.
 *  - Recommendations render with their uniform Preview/Apply/Undo rows
 *    (RecommendationRow) when the report carries them — THIS is the base of
 *    the post-MVP resolution strategy.
 *  - Empty state when there is no report yet (analyzed=false): invite to
 *    program first + a way back to Programación.
 *
 * The workspace produces `analyzed` via the registry (the report lives in the
 * analysis store, populated by the programming flow); this view consumes it.
 */
export function EvaluationWorkspace() {
  const report = useAnalysisStore((s) => s.report)
  const selectedRegion = useSelectedRegion()
  const navigate = useNavigate()

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <ShieldCheck className="h-10 w-10 mb-3 text-primary-weak" />
        <h1 className="text-sm font-bold text-foreground mb-1">Evaluación</h1>
        <p className="text-xs text-muted-foreground mb-4">
          Evaluá el plan antes de ejecutar — compilá o generá un plan primero.
        </p>
        <button
          onClick={() => navigate('/task')}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium
                     rounded-lg border border-primary-mid bg-primary-weak text-primary
                     hover:bg-primary-weak transition-all cursor-pointer"
        >
          Volver a Programación
        </button>
      </div>
    )
  }

  const hasProblemRegions = (report.problem_regions ?? []).length > 0
  const recommendations = report.recommendations ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Evaluation header: the decision this view exists for ── */}
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2 shrink-0">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-bold text-foreground leading-tight">Evaluación</h1>
          <p className="text-[10px] text-muted-foreground">Revisá el plan antes de ejecutar</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        <PlanSummary />
        <StatusBanner />
        <TrajectoryView />

        {selectedRegion ? (
          <RegionInspector />
        ) : (
          <>
            {/* Problem regions grouped (never the 200-observation dump). */}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Problem Regions
              </h2>
              {hasProblemRegions ? (
                <ProblemRegions />
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4 rounded-lg border border-border bg-card/50">
                  No se detectaron problemas — el plan está listo.
                </p>
              )}
            </section>

            {/* Recommendations — uniform Preview/Apply/Undo rows. */}
            {recommendations.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Recommendations
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {recommendations.map((recommendation) => (
                    <RecommendationRow key={recommendation.id} recommendation={recommendation} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * PlanSummary — what is about to execute. Derived from the stores the
 * programming flow already populates: semantic editor (Tasks source +
 * instruction count), viewport scene store (waypoints + duration) and the
 * analysis report (analyzed waypoints fallback, plan id).
 */
function PlanSummary() {
  const report = useAnalysisStore((s) => s.report)
  const source = useSemanticEditor((s) => (s.result ? 'Tasks' : 'Motion'))
  const instructionCount = useSemanticEditor((s) => s.result?.metadata.instruction_count)
  const visualization = useSceneStore((s) => s.activePlan?.visualization)
  const segments = useSceneStore((s) => s.activePlan?.segments)

  const waypoints =
    visualization?.waypoints?.length ?? report?.manipulability_series?.length ?? 0
  const durationSecs = segments
    ? segments.reduce((max, segment) => Math.max(max, segment.timeEnd), 0)
    : null

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        Plan
      </span>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <SummaryItem label="Fuente" value={source} />
        <SummaryItem label="Plan" value={report?.artifact.id ?? '—'} />
        <SummaryItem label="Waypoints" value={String(waypoints)} />
        <SummaryItem label="Duración" value={durationSecs !== null ? formatDuration(durationSecs) : '—'} />
        <SummaryItem
          label="Instrucciones"
          value={instructionCount !== undefined ? String(instructionCount) : '—'}
        />
      </dl>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

/** Compact duration label: seconds, or minutes + seconds past 60s. */
function formatDuration(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}m ${s}s`
}
