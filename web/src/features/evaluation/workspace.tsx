import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router'
import { useAnalysisStore, useSelectedRegion } from '@/features/analysis/store'
import { StatusBanner } from '@/features/analysis/components/status-banner'
import { ProblemRegions } from '@/features/analysis/components/problem-regions'
import { RegionInspector } from '@/features/analysis/components/region-inspector'
import { RecommendationRow } from '@/features/planning/components/RecommendationRow'
import { useSemanticEditor } from '@/features/semantic/store'
import { useSceneStore } from '@/features/viewport/store'
import { dedupeRecommendations, recommendationKey } from '@/shared/contracts/analysis-report'
import { YoshikawaChart } from './components/yoshikawa-chart'
import { DeterminantChart } from './components/determinant-chart'
import { ProgramView } from './components/program-view'
import { ShieldCheck } from 'lucide-react'

// TrajectoryView mounts ECharts GL — lazy like the 2D EChart wrapper (C2:
// ECharts/echarts-gl stay out of the eager initial bundle).
const TrajectoryView = lazy(() =>
  import('./components/trajectory-view').then((module) => ({ default: module.TrajectoryView })),
)

/**
 * EvaluationWorkspace — the pre-execution EVALUACIÓN (hotfix
 * evaluation-workspace, /evaluation, stage 4).
 *
 * The analysis check STOPS being a tab inside Programación and becomes a
 * VISTA of its own: a "¿estás seguro que querés ejecutar esto?" checkpoint
 * between Programación and Ejecución, with concrete actions instead of an
 * un-actionable dump of up-to-200 observations.
 *
 * Layout + gating decisions (hotfix evaluation-layout):
 *  - StatusBanner full-width verdict FIRST, then the decision context:
 *    Plan summary (what is about to execute) + the trajectory view.
 *  - 3-portion grid at lg (collapses to stacked below): porción 1 = Yoshikawa
 *    manipulability chart, porción 2 = Jacobian determinant chart (both with
 *    their threshold reference lines), porción 3 = problem regions list + the
 *    selected region's detail (RegionInspector). Charts are now prominent
 *    instead of buried; region selection drives the detail in-place.
 *  - Recommendations render below the grid with their uniform
 *    Preview/Apply/Undo rows (RecommendationRow) when the report carries them.
 *    Duplicates (same kind + edit variant) are deduped as a frontend safety net.
 *  - Recommended strategies are NOT shown in the region inspector (the user
 *    does not use them); repair options + optimization stay hidden (post-MVP).
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
  const recommendations = dedupeRecommendations(report.recommendations ?? [])

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
        {/* Verdict + decision context: plan summary and trajectory. */}
        <StatusBanner />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 items-start">
          <PlanSummary />
          <div className="lg:col-span-2 min-w-0">
            <Suspense fallback={<div className="h-64 w-full" aria-label="Trajectory with problem regions" />}>
              <TrajectoryView />
            </Suspense>
          </div>
        </div>

        {/* 3-portion grid at lg (stacked below): the two jacobian charts are
            the visual focus, the third portion is the problem regions list +
            the selected region's detail. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 items-start">
          <YoshikawaChart />
          <DeterminantChart />
          <section className="flex flex-col gap-2 min-w-0">
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
            {selectedRegion ? (
              <RegionInspector />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card/30 px-3 py-6 text-center">
                <span className="text-xs text-muted-foreground">
                  Select a region to inspect its details
                </span>
                <span className="text-[10px] text-muted-foreground/70">
                  Click a region in the list or on the trajectory.
                </span>
              </div>
            )}
          </section>
        </div>

        {/* Program — the structured, non-editable state of the plan's motion
            program, connected to the problem regions above (step 2 CDD:
            "which segment is the one I must edit"). */}
        <ProgramView />

        {/* Recommendations — the base of the post-MVP resolution strategy. */}
        {recommendations.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Recommendations
            </h2>
            <ul className="flex flex-col gap-1.5">
              {recommendations.map((recommendation) => (
                <RecommendationRow
                  key={recommendationKey(recommendation)}
                  recommendation={recommendation}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * PlanSummary — what is about to execute. Derived from the stores the
 * programming flow already populates: semantic editor (Tasks source +
 * instruction count), viewport scene store (waypoints + duration + robot DOF +
 * initial joints) and the analysis report (analyzed waypoints fallback, plan
 * id, score/grade).
 */
function PlanSummary() {
  const report = useAnalysisStore((s) => s.report)
  const source = useSemanticEditor((s) => (s.result ? 'Tasks' : 'Motion'))
  const instructionCount = useSemanticEditor((s) => s.result?.metadata.instruction_count)
  const visualization = useSceneStore((s) => s.activePlan?.visualization)
  const segments = useSceneStore((s) => s.activePlan?.segments)
  const runtime = useSceneStore((s) => s.runtime)

  const waypoints =
    visualization?.waypoints?.length ?? report?.manipulability_series?.length ?? 0
  const durationSecs = segments
    ? segments.reduce((max, segment) => Math.max(max, segment.timeEnd), 0)
    : null
  const dof = runtime?.robot.dof ?? null
  const initialJoints = runtime?.joints?.length
    ? `[${runtime.joints.map((j) => j.toFixed(2)).join(', ')}]`
    : null

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Plan
        </span>
        {report && (
          <span className="text-[10px] font-mono font-semibold text-primary bg-primary-weak px-2 py-0.5 rounded tabular-nums">
            Score {report.summary.score} · {report.summary.grade}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        <SummaryItem label="Fuente" value={source} />
        <SummaryItem label="Plan" value={report?.artifact.id ?? '—'} />
        <SummaryItem label="Waypoints" value={String(waypoints)} />
        <SummaryItem label="Duración" value={durationSecs !== null ? formatDuration(durationSecs) : '—'} />
        <SummaryItem label="Instrucciones" value={instructionCount !== undefined ? String(instructionCount) : '—'} />
        <SummaryItem label="DOF" value={dof !== null ? String(dof) : '—'} />
      </dl>
      {initialJoints && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>Joints iniciales</span>
          <code className="font-mono text-foreground/80 tabular-nums">{initialJoints}</code>
        </div>
      )}
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
