import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router'
import { useAnalysisStore, useSelectedRegion } from '@/features/analysis/store'
import { StatusBanner } from '@/features/analysis/components/status-banner'
import { ProblemRegions } from '@/features/analysis/components/problem-regions'
import { RegionInspector } from '@/features/analysis/components/region-inspector'
import { RecommendationRow } from '@/features/planning/components/RecommendationRow'
import { useSemanticEditor } from '@/features/semantic/store'
import { gradeFromScore } from '@/shared/analysis/verdict'
import { useSceneStore } from '@/features/viewport/store'
import {
  dedupeRecommendations,
  hasCollisions,
  minClearanceDistance,
  minClearanceWaypoint,
  recommendationKey,
  recommendationRegionId,
} from '@/shared/contracts/analysis-report'
import { YoshikawaChart } from './components/yoshikawa-chart'
import { DeterminantChart } from './components/determinant-chart'
import { ProgramView } from './components/program-view'
import { IntelligenceView } from './components/intelligence/IntelligenceView'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { requirementReason } from '@/shared/workflow/derive'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { ArrowRight, ShieldCheck } from 'lucide-react'

// TrajectoryView mounts ECharts GL — lazy like the 2D EChart wrapper (C2:
// ECharts/echarts-gl stay out of the eager initial bundle).
const TrajectoryView = lazy(() =>
  import('./components/trajectory-view').then((module) => ({ default: module.TrajectoryView })),
)

/**
 * EvaluationWorkspace — the pre-execution EVALUATION (hotfix
 * evaluation-workspace, /evaluation, stage 4).
 *
 * The analysis check STOPS being a tab inside Programming and becomes a
 * VISTA of its own: an "are you sure you want to execute this?" checkpoint
 * between Programming and Execution, with concrete actions instead of an
 * un-actionable dump of up-to-200 observations.
 *
 * Layout + gating decisions (hotfix evaluation-layout):
 *  - StatusBanner full-width verdict FIRST, then the decision context:
 *    Plan summary (what is about to execute) + the trajectory view.
 *  - 3-portion grid at lg (collapses to stacked below): portion 1 = Yoshikawa
 *    manipulability chart, portion 2 = Jacobian determinant chart (both with
 *    their threshold reference lines), portion 3 = problem regions list + the
 *    selected region's detail (RegionInspector). Charts are now prominent
 *    instead of buried; region selection drives the detail in-place.
 *  - Recommendations render below the grid with their uniform
 *    Preview/Apply/Undo rows (RecommendationRow) when the report carries them.
 *    Duplicates (same kind + edit variant) are deduped as a frontend safety net.
 *  - Recommended strategies are NOT shown in the region inspector (the user
 *    does not use them); repair options + optimization stay hidden (post-MVP).
 *  - Empty state when there is no report yet (analyzed=false): invite to
 *    program first + a way back to Programming.
 *
 * The workspace produces `analyzed` via the registry (the report lives in the
 * analysis store, populated by the programming flow); this view consumes it.
 */
export function EvaluationWorkspace() {
  const report = useAnalysisStore((s) => s.report)
  const selectedRegion = useSelectedRegion()
  const navigate = useNavigate()
  // Guard-aware forward path (P1.4): the CTA reflects whether /execution is
  // reachable. Same registry + WorkflowState contract the GuardedRoute and
  // TopBar enforce — the forward CTA can never contradict the guards.
  const flags = useWorkflowState()
  const executionEntry = WORKSPACE_REGISTRY.find((e) => e.workspace === 'execution')
  const executionBlockReason = executionEntry
    ? requirementReason(executionEntry, flags)
    : 'Requires a runnable execution'
  const executionReachable = executionBlockReason === null

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <ShieldCheck className="h-10 w-10 mb-3 text-primary-weak" />
        <h1 className="text-sm font-bold text-foreground mb-1">Evaluation</h1>
        <p className="text-xs text-muted-foreground mb-4">
          Evaluate the plan before executing — compile or generate a plan first.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => navigate('/task')}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium
                       rounded-lg border border-primary-mid bg-primary-weak text-primary
                       hover:bg-primary-weak transition-all cursor-pointer"
          >
            Back to Programming
          </button>
          {executionReachable && <ContinueToExecution reason={executionBlockReason} />}
        </div>
      </div>
    )
  }

  const hasProblemRegions = (report.problem_regions ?? []).length > 0
  const recommendations = dedupeRecommendations(report.recommendations ?? [])

  // Master-detail (CDD redesign): the detail pane is contextual on the
  // selected region. Recommendations tied to THAT region come first;
  // plan-general ones (no resolvable region chain — see
  // `recommendationRegionId`) are always actionable and stay visible;
  // recommendations of OTHER regions are hidden — they belong to that
  // region's own drill-down.
  const visibleRecommendations = selectedRegion
    ? recommendations.filter((recommendation) => {
        const regionId = recommendationRegionId(recommendation, report)
        return regionId === selectedRegion.id || regionId === null
      })
    : recommendations

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Evaluation header: the decision this view exists for ── */}
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2 shrink-0">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <div>
          <h1 className="text-sm font-bold text-foreground leading-tight">Evaluation</h1>
          <p className="text-[10px] text-muted-foreground">Review the plan before executing</p>
        </div>
      </div>

      {/* Two tabs: "Evaluation" (default — the decision this view exists for)
          and "Intelligence" (the AI/fuzzy verdict — ONLY when the report
          carries an assessment, spec evaluation-intelligence-tab). */}
      <Tabs defaultValue="evaluation" className="flex flex-col h-full overflow-hidden min-h-0">
        <TabsList className="mx-3 mt-3 shrink-0">
          <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
          {report.assessment && <TabsTrigger value="intelligence">Intelligence</TabsTrigger>}
        </TabsList>

        {/* Evaluation tab — the pre-refactor content, unchanged: verdict banner
            + the master-detail decision grid. */}
        <TabsContent value="evaluation" className="flex-1 min-h-0 overflow-y-auto p-3">
          {/* Verdict spans the whole decision — full-width above the split. */}
          <StatusBanner />

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3 items-start">
            {/* ── MASTER (context, ~2/3): WHERE the problem is — trajectory +
                temporal analysis, all cross-highlighting the selected region. */}
            <div
              className="lg:col-span-2 flex flex-col gap-4 min-w-0"
              data-testid="evaluation-master"
            >
              <PlanSummary />
              <Suspense fallback={<div className="h-64 w-full" aria-label="Trajectory with problem regions" />}>
                <TrajectoryView />
              </Suspense>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 min-w-0">
                <YoshikawaChart />
                <DeterminantChart />
              </div>
            </div>

            {/* ── DETAIL (action, ~1/3): WHAT to do with the problem. The
                Problem Regions chooser is ALWAYS visible — selecting a region
                never replaces it; the RegionInspector opens in-place below the
                list (the chosen row stays highlighted) and ProgramView (the
                editable segment) + Recommendations always live here. In mobile
                the detail collapses below the master. */}
            <aside
              className="lg:col-span-1 flex flex-col gap-4 min-w-0"
              data-testid="evaluation-detail"
            >
              <section className="flex flex-col gap-2 min-w-0">
                <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Problem Regions
                </h2>
                {hasProblemRegions ? (
                  <ProblemRegions />
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4 rounded-lg border border-border bg-card/50">
                    No problems detected — the plan is ready.
                  </p>
                )}
              </section>

              {/* RegionInspector — the selected region's drill-down detail.
                  Below the list (never replacing it) so the selection context
                  stays on screen; ProgramView remains the editable segment. */}
              {selectedRegion && <RegionInspector />}

              <ProgramView />

              {/* Recommendations — the base of the post-MVP resolution strategy
                  (Preview/Apply/Undo). */}
              {visibleRecommendations.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Recommendations
                  </h2>
                  <ul className="flex flex-col gap-1.5">
                    {visibleRecommendations.map((recommendation) => (
                      <RecommendationRow
                        key={recommendationKey(recommendation)}
                        recommendation={recommendation}
                        report={report}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>

          {/* ── Forward decision gate (P1.4): Evaluation is no dead-end. The
              primary action lives AFTER the detail column content, in a footer
              bar under both columns. Guard-aware: disabled (aria-disabled +
              title, the TopBar blocked-link pattern) while /execution is not
              reachable — the tooltip keeps the reason readable. */}
          <div className="mt-4 flex justify-end border-t border-border/50 pt-3">
            <ContinueToExecution reason={executionBlockReason} />
          </div>
        </TabsContent>

        {/* Intelligence tab — the COMPOSED AI verdict view; hidden entirely
            when the report carries no assessment. */}
        {report.assessment && (
          <TabsContent value="intelligence" className="flex-1 min-h-0 overflow-y-auto p-3">
            <IntelligenceView
              assessment={report.assessment}
              regions={report.problem_regions ?? []}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

/**
 * ContinueToExecution — the primary forward action that ENDS Evaluation (P1.4).
 *
 * A disabled-button look with aria-disabled + title + click-prevention, the
 * same pattern TopBar's `WorkspaceNavLink` uses for blocked links: a native
 * `disabled` attribute would suppress the title tooltip in most browsers, so
 * the reason stays visible as a tooltip while the action is inert.
 */
function ContinueToExecution({ reason }: { reason: string | null }) {
  const navigate = useNavigate()
  const reachable = reason === null
  return (
    <button
      type="button"
      data-testid="evaluation-forward-cta"
      aria-disabled={reachable ? undefined : true}
      title={reachable ? undefined : (reason ?? undefined)}
      onClick={() => {
        if (reachable) navigate('/execution')
      }}
      className={cn(
        buttonVariants({ variant: 'default', size: 'default' }),
        'gap-2 cursor-pointer',
        !reachable && 'opacity-40',
      )}
    >
      Continue to Execution
      <ArrowRight className="size-3.5" />
    </button>
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
            Score {report.summary.score} · {gradeFromScore(report.summary.score)}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        <SummaryItem label="Source" value={source} />
        <SummaryItem label="Plan" value={report?.artifact.id ?? '—'} />
        <SummaryItem label="Waypoints" value={String(waypoints)} />
        <SummaryItem label="Duration" value={durationSecs !== null ? formatDuration(durationSecs) : '—'} />
        <SummaryItem label="Instructions" value={instructionCount !== undefined ? String(instructionCount) : '—'} />
        <SummaryItem label="DOF" value={dof !== null ? String(dof) : '—'} />
      </dl>
      <MetricChips metrics={report?.metrics} />
      {initialJoints && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>Initial joints</span>
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

interface MetricChip {
  label: string
  value: string
  tone: 'good' | 'bad' | 'neutral'
}

function MetricChips({ metrics }: { metrics: Record<string, number> | undefined }) {
  if (metrics === undefined || Object.keys(metrics).length === 0) return null

  const chips: MetricChip[] = []

  const avg = metrics['avg_manipulability']
  if (avg !== undefined) {
    chips.push({ label: 'Yoshikawa avg', value: avg.toFixed(3), tone: 'neutral' })
  }
  const near = metrics['near_singular_count']
  const exact = metrics['singular_count']
  if ((near ?? 0) > 0 || (exact ?? 0) > 0) {
    chips.push({
      label: 'Singularities',
      value: `${near ?? 0} near · ${exact ?? 0} exact`,
      tone: 'neutral',
    })
  }
  const duration = metrics['trajectory_duration']
  if (duration !== undefined) {
    chips.push({ label: 'Analysis duration', value: formatDuration(duration), tone: 'neutral' })
  }

  const minClearance = minClearanceDistance(metrics)
  if (minClearance !== null) {
    const waypoint = minClearanceWaypoint(metrics)
    chips.push({
      label: 'Min obstacle distance',
      value: waypoint !== null
        ? `${minClearance.toFixed(2)} m @ wp${waypoint}`
        : `${minClearance.toFixed(2)} m`,
      tone: minClearance < 0 ? 'bad' : 'neutral',
    })
  } else if (hasCollisions(metrics)) {
    chips.push({ label: 'Collisions', value: 'Yes', tone: 'bad' })
  } else if (metrics['has_collisions'] === 0) {
    chips.push({ label: 'Collisions', value: 'No collisions', tone: 'good' })
  }

  if (chips.length === 0) return null

  const toneClass: Record<MetricChip['tone'], string> = {
    good: 'text-chart-3',
    bad: 'text-destructive',
    neutral: 'text-foreground',
  }

  return (
    <div data-testid="metric-chips" className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
      {chips.map((chip) => (
        <div
          key={chip.label}
          data-testid="metric-chip"
          className="flex flex-col gap-1 rounded-md border border-border bg-secondary/10 px-2.5 py-2"
        >
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {chip.label}
          </span>
          <span className={`text-sm font-mono font-semibold tabular-nums ${toneClass[chip.tone]}`}>
            {chip.value}
          </span>
        </div>
      ))}
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
