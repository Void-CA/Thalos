import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { SceneStore } from '../../../features/scene/store/scene.store';
import { WorkspaceStore } from '../../../features/workspace/store/workspace.store';
import { PlanAnalysisStore } from '../../../features/plan-analysis/store/plan-analysis.store';
import { FocusService } from '../../services/focus.service';
import { ActionDispatcher } from '../../services/action-dispatcher.service';
import { suggestionKindToAction } from '../../types/recommendation-action';
import { PlanningStore } from '../../store/planning.store';
import { LogStore } from '../../store/log.store';
import { LayoutStore } from '../../store/layout.store';
import type { RecommendationDto } from '../../../features/plan-analysis/plan-analysis-api.types';

type TabId = 'snapshot' | 'analysis' | 'timeline' | 'plan-analysis' | 'log';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'snapshot', label: 'Snapshot', icon: 'heroCamera' },
  { id: 'analysis', label: 'Analysis', icon: 'heroChartBar' },
  { id: 'timeline', label: 'Timeline', icon: 'heroClock' },
  { id: 'plan-analysis', label: 'Plan Analysis', icon: 'heroClipboardDocumentCheck' },
  { id: 'log', label: 'Log', icon: 'heroDocumentText' },
];

const SEGMENT_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

/**
 * Bottom panel — system observability in tabs.
 *
 * Tabs:
 *   - Snapshot: raw runtime JSON.
 *   - Analysis: structured IK + workspace results.
 *   - Timeline: execution progress.
 *   - Log: error messages.
 */
@Component({
  selector: 'bottom-panel',
  standalone: true,
  imports: [NgIcon],
  template: `
    <div class="bottom-panel" [class.bottom-panel--collapsed]="layout.bottomCollapsed()">
      @if (!layout.bottomCollapsed()) {
        <div class="bottom-panel__tabs">
          @for (t of tabs; track t.id) {
            <button
              class="bottom-panel__tab"
              [class.bottom-panel__tab--active]="activeTab() === t.id"
              (click)="activeTab.set(t.id)"
            >
              <ng-icon [name]="t.icon" size="16" />
              {{ t.label }}
              @if (t.id === 'plan-analysis') {
                @let badge = planAnalysisBadge();
                @if (badge) {
                  <span class="bottom-panel__tab-badge" [class]="'badge--' + badge.kind">{{ badge.label }}</span>
                }
              }
            </button>
          }
          <span class="bottom-panel__spacer"></span>
          <button
            class="bottom-panel__collapse"
            (click)="layout.toggleBottom()"
            title="Collapse panel"
          >▼</button>
        </div>

        <div class="bottom-panel__content">
          @if (activeTab() === 'snapshot') {
            <pre class="bottom-panel__json">{{ snapshotJson() }}</pre>
          }

          @if (activeTab() === 'analysis') {
            @let a = analysis();
            @if (a.hasResults) {
              <div class="analysis">
                @if (a.ik) {
                  <div class="analysis__card">
                    <h4 class="analysis__card-title">IK Result</h4>
                    <span class="analysis__badge"
                      [class.analysis__badge--ok]="a.ik.status === 'Converged'"
                      [class.analysis__badge--warn]="a.ik.status === 'MaxIterations'"
                    >{{ a.ik.status }}</span>
                    <table class="analysis__table">
                      <tr><td>Iterations</td><td>{{ a.ik.iterations }}</td></tr>
                      <tr><td>Error</td><td>{{ a.ik.finalError.toFixed(4) }}</td></tr>
                    </table>
                    @if (a.solvedQ) {
                      <div class="analysis__chips">
                        @for (v of a.solvedQ; track $index) {
                          <span class="analysis__chip">q{{ $index + 1 }}: {{ v.toFixed(3) }}</span>
                        }
                      </div>
                    }
                  </div>
                }

                @if (a.workspace) {
                  <div class="analysis__card">
                    <h4 class="analysis__card-title">Workspace</h4>
                    <table class="analysis__table">
                      <tr><td>Samples</td><td>{{ a.workspace.metrics.sampleCount }}</td></tr>
                      <tr><td>Max Reach</td><td>{{ a.workspace.metrics.maxReach.toFixed(3) }} m</td></tr>
                      <tr><td>Min Reach</td><td>{{ a.workspace.metrics.minReach.toFixed(3) }} m</td></tr>
                      <tr><td>Volume</td><td>{{ a.workspace.metrics.boundingVolume.toFixed(3) }} m³</td></tr>
                    </table>
                  </div>
                }

                @if (a.singularity) {
                  <div class="analysis__card">
                    <h4 class="analysis__card-title">Singularity</h4>
                    <table class="analysis__table">
                      <tr><td class="analysis__state-normal">Normal</td><td>{{ a.singularity.metrics.normalCount }}</td></tr>
                      <tr><td class="analysis__state-near">Near</td><td>{{ a.singularity.metrics.nearSingularCount }}</td></tr>
                      <tr><td class="analysis__state-singular">Singular</td><td>{{ a.singularity.metrics.singularCount }}</td></tr>
                      <tr><td>Condition #</td><td>{{ a.singularity.metrics.avgConditionNumber.toFixed(1) }}</td></tr>
                    </table>
                  </div>
                }

                @if (a.manipulability) {
                  <div class="analysis__card">
                    <h4 class="analysis__card-title">Manipulability</h4>
                    <table class="analysis__table">
                      <tr><td>Avg Yoshikawa</td><td>{{ a.manipulability.metrics.avgYoshikawa.toFixed(4) }}</td></tr>
                      <tr><td>Min</td><td>{{ a.manipulability.metrics.minYoshikawa.toFixed(4) }}</td></tr>
                      <tr><td>Max</td><td>{{ a.manipulability.metrics.maxYoshikawa.toFixed(4) }}</td></tr>
                      <tr><td>Avg Isotropy</td><td>{{ a.manipulability.metrics.avgIsotropy.toFixed(4) }}</td></tr>
                    </table>
                  </div>
                }
              </div>
            } @else {
              <p class="bottom-panel__empty">No analysis results. Run FK/IK or workspace analysis from the right panel.</p>
            }
          }

          @if (activeTab() === 'timeline') {
            @let plan = tlPlan();
            @if (!plan) {
              <p class="bottom-panel__empty">No active plan. Compile a program in Planning mode to see timeline.</p>
            } @else {
              <div class="tl">
                <div class="tl__header">
                  <span class="tl__badge" [style.--badge-color]="plan.badgeColor">{{ plan.stateLabel }}</span>
                  <span class="tl__id">{{ plan.planId }}</span>
                  <span class="tl__type">{{ plan.motionType }}</span>
                </div>
                @if (plan.segments.length > 0) {
                  <div class="tl__segments">
                    @for (seg of plan.segments; track seg.index) {
                      <div class="tl__segment" [style.width.%]="seg.pct" [style.background]="seg.color" [title]="seg.label">
                        <span class="tl__segment-label">{{ seg.label }}</span>
                      </div>
                    }
                  </div>
                }
                <div class="tl__progress">
                  <div class="tl__progress-track">
                    <div class="tl__progress-fill" [style.width.%]="plan.progressPct" [style.background]="plan.fillColor"></div>
                    @if (plan.progressPct > 0 && plan.progressPct < 100) {
                      <div class="tl__marker" [style.left.%]="plan.progressPct"></div>
                    }
                  </div>
                  <span class="tl__pct">{{ plan.progressPct }}%</span>
                </div>
                <div class="tl__times">
                  <span class="tl__time">Elapsed: {{ plan.elapsed }}</span>
                  @if (plan.duration) { <span class="tl__time">Total: {{ plan.duration }}</span> }
                </div>
                @if (plan.waypointCount > 0) {
                  <div class="tl__wpts">
                    @for (wp of plan.wpPositions; track $index) {
                      <span class="tl__wpt" [style.left.%]="wp.pct" [title]="wp.label"
                        [class.tl__wpt--start]="wp.type === 'Start'"
                        [class.tl__wpt--goal]="wp.type === 'Goal'"
                        [class.tl__wpt--via]="wp.type === 'Via'"></span>
                    }
                  </div>
                }
                @if (plan.isLive) { <span class="tl__live">● LIVE</span> }
              </div>
            }
          }

          @if (activeTab() === 'plan-analysis') {
            @let pa = planAnalysis();
            @if (pa.loading) {
              <p class="bottom-panel__empty">Analyzing plan…</p>
            } @else if (pa.hasResult) {
              <div class="plan-analysis">
                <!-- Score -->
                <div class="plan-analysis__score-row">
                  <div class="plan-analysis__score" [class]="'score--' + pa.status">
                    <span class="plan-analysis__score-value">{{ pa.score }}</span>
                    <span class="plan-analysis__score-grade">{{ pa.grade }}</span>
                  </div>
                  <p class="plan-analysis__message">{{ pa.message }}</p>
                </div>

                <!-- Metrics -->
                <div class="plan-analysis__metrics">
                  @if (pa.metrics; as m) {
                    <span class="plan-analysis__metric">⏱ {{ m.duration.toFixed(1) }}s</span>
                    @if (m.average_manipulability != null) {
                      <span class="plan-analysis__metric">&mu; {{ m.average_manipulability.toFixed(2) }}</span>
                    }
                    @if (m.min_collision_distance != null && m.min_collision_distance > 0) {
                      <span class="plan-analysis__metric">&#x2399; {{ (m.min_collision_distance * 1000).toFixed(0) }}mm</span>
                    }
                    @if (m.singular_count > 0) {
                      <span class="plan-analysis__metric plan-analysis__metric--warn">&#x26D4; {{ m.singular_count }} singular</span>
                    }
                  }
                </div>

                <!-- Findings (agrupados por tipo) -->
                @let groups = groupedFindings();
                @if (groups.length > 0) {
                  <section class="plan-analysis__findings">
                    <h4 class="plan-analysis__findings-title">
                      Findings ({{ pa.findings.length }})
                    </h4>
                    <div class="plan-analysis__groups">
                      @for (g of groups; track g.kind) {
                        <details class="plan-analysis__group" open>
                          <summary class="plan-analysis__group-header">
                            <span class="plan-analysis__group-sev">{{ iconFor(g.severity) }}</span>
                            <span class="plan-analysis__group-kind">{{ g.kind.replace(/_/g, ' ') }}</span>
                            <span class="plan-analysis__group-count" [class]="'count--' + g.severity">{{ g.count }}</span>
                          </summary>
                          <div class="plan-analysis__group-body">
                            <p class="plan-analysis__group-msg">{{ g.message }}</p>
                            @if (g.waypoints.length > 0) {
                              <div class="plan-analysis__group-wpts">
                                @for (wp of g.waypoints; track wp; let i = $index) {
                                  @if (i < 20) {
                                    <span class="plan-analysis__group-wpt" (click)="onPlanFindingClick(wp)">
                                      wp{{ wp }}
                                    </span>
                                  } @else if (i === 20) {
                                    <span class="plan-analysis__group-more">&hellip; ({{ g.waypoints.length - 20 }} more)</span>
                                  }
                                }
                              </div>
                            }
                          </div>
                        </details>
                      }
                    </div>
                  </section>
                }

                <!-- Recommendations -->
                @if (pa.recommendations.length > 0) {
                  <details class="plan-analysis__section" open>
                    <summary class="plan-analysis__section-header">
                      Recommendations ({{ pa.recommendations.length }})
                    </summary>
                    <ul class="plan-analysis__list">
                      @for (r of pa.recommendations; track r) {
                        <li class="plan-analysis__recommendation">
                          <div class="plan-analysis__rec-header">
                            <span class="plan-analysis__rec-impact" [class]="'impact--' + r.impact">{{ r.impact }}</span>
                            <span class="plan-analysis__rec-kind">{{ r.kind.replace('_', ' ') }}</span>
                            <button class="plan-analysis__rec-apply" (click)="onApplyRecommendation(r)">Apply</button>
                          </div>
                          <p class="plan-analysis__rec-msg">{{ r.message }}</p>
                        </li>
                      }
                    </ul>
                  </details>
                }
              </div>
            } @else {
              <p class="bottom-panel__empty">
                Compile a plan in <strong>Planning</strong> mode to see analysis results.
              </p>
            }
          }

          @if (activeTab() === 'log') {
            @let entries = logEntries();
            @if (entries.length === 0) {
              <p class="bottom-panel__empty">No log entries.</p>
            } @else {
              <div class="log">
                @for (entry of entries; track entry.time) {
                  <div class="log__entry" [class.log__entry--error]="entry.level === 'error'">
                    <span class="log__time">{{ entry.time }}</span>
                    <span class="log__level">{{ entry.level }}</span>
                    <span class="log__msg">{{ entry.msg }}</span>
                  </div>
                }
              </div>
            }
          }
        </div>
      } @else {
        <div class="bottom-panel__stub">
          <button class="bottom-panel__expand" (click)="layout.toggleBottom()" title="Expand panel">▲</button>
        </div>
      }
    </div>
  `,
  styleUrl: './bottom-panel.scss',
})
export class BottomPanel {
  protected readonly scene = inject(SceneStore);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly pa = inject(PlanAnalysisStore);
  private readonly focus = inject(FocusService);
  private readonly actions = inject(ActionDispatcher);
  private readonly planning = inject(PlanningStore);
  protected readonly log = inject(LogStore);
  protected readonly layout = inject(LayoutStore);

  protected readonly activeTab = signal<TabId>('snapshot');
  protected readonly tabs = TABS;

  // ── Snapshot ──

  protected readonly snapshotJson = computed(() => {
    const state = this.scene.state();
    if (!state.runtime) return '(no scene loaded)';
    const exe = state.execution;
    return JSON.stringify(
      {
        robot: state.runtime.robot,
        joints: state.runtime.joints,
        ikResult: state.ikResult,
        activePlan: state.activePlan
          ? {
              planId: state.activePlan.planId,
              state: state.activePlan.state,
              motionType: state.activePlan.motionType,
              progress: state.activePlan.trajectoryProgress,
              waypoints: state.activePlan.visualization?.waypoints.length ?? 0,
            }
          : null,
        execution: exe
          ? { status: exe.status, progress: exe.progress, elapsedSecs: exe.elapsedSecs }
          : null,
        generatedAt: state.runtime.generatedAt,
      },
      null,
      2,
    );
  });

  // ── Analysis ──

  protected readonly analysis = computed(() => {
    const scene = this.scene.state();
    const ik = scene.ikResult;
    const solvedQ = scene.solvedQ;
    const wsData = this.ws.data();
    const singularity = this.ws.singularity();
    const manipulability = this.ws.manipulability();

    const hasResults = !!(ik || wsData || singularity || manipulability);

    return {
      hasResults,
      ik,
      solvedQ,
      workspace: wsData,
      singularity,
      manipulability,
    };
  });

  // ── Timeline ──

  protected readonly tlPlan = computed(() => {
    const state = this.scene.state();
    const plan = state?.activePlan;
    const exe = state?.execution;
    if (!plan) return null;

    const effectiveState = exe?.status ?? plan.state;
    const progress = exe?.progress ?? plan.trajectoryProgress ?? 0;
    const progressPct = Math.round(progress * 100);

    const badgeColorMap: Record<string, string> = {
      Created: '#ffaa33', Active: '#33ccff', Paused: '#ffaa33',
      Completed: '#44cc44', Cancelled: '#cc4444', Failed: '#cc4444',
    };
    const fillColorMap: Record<string, string> = {
      Created: '#ffaa33', Active: '#33ccff', Paused: '#ffaa33',
      Completed: '#44cc44', Cancelled: '#666', Failed: '#cc4444',
    };

    const segments = plan.segments?.map((seg, i) => ({
      index: seg.segmentIndex,
      pct: seg.waypointEnd - seg.waypointStart,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      label: `${seg.motionType} [${seg.timeStart.toFixed(1)}s-${seg.timeEnd.toFixed(1)}s]`,
    })) ?? [];

    const waypoints = plan.visualization?.waypoints ?? [];
    const duration = waypoints.length > 0 ? waypoints[waypoints.length - 1].timestamp : null;
    const wpPositions = waypoints.map((wp) => ({
      pct: duration && duration > 0 ? Math.round((wp.timestamp / duration) * 100) : 0,
      label: `${wp.waypointType} @ ${wp.timestamp.toFixed(2)}s`,
      type: wp.waypointType,
    }));

    return {
      planId: plan.planId, stateLabel: effectiveState,
      badgeColor: badgeColorMap[effectiveState] ?? '#888',
      fillColor: fillColorMap[effectiveState] ?? '#888',
      motionType: plan.motionType, progress, progressPct,
      segments, waypointCount: waypoints.length, wpPositions,
      elapsed: exe?.elapsedSecs != null ? `${exe.elapsedSecs.toFixed(1)}s` : '—',
      duration: duration != null ? `${duration.toFixed(1)}s` : null,
      isLive: effectiveState === 'Active',
    };
  });

  // ── Plan Analysis ──

  /** Badge metadata for the Plan Analysis tab. Null when nothing to show. */
  protected readonly planAnalysisBadge = computed<{ kind: string; label: string } | null>(() => {
    const findings = this.pa.findings();
    if (findings.length === 0) return null;

    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;

    if (errors > 0) return { kind: 'error', label: `\u2715 ${errors}` };
    if (warnings > 0) return { kind: 'warn', label: `\u26A0 ${warnings}` };
    return { kind: 'info', label: `\u2139 ${findings.length}` };
  });

  /** Aggregated plan-analysis view-model. */
  protected readonly planAnalysis = computed(() => {
    const summary = this.pa.summary();
    const metrics = this.pa.metrics();
    const findings = this.pa.findings();
    const recommendations = this.pa.recommendations();

    return {
      hasResult: summary !== null || findings.length > 0,
      loading: this.pa.loading(),
      status: summary?.status ?? 'ok',
      score: summary?.score ?? 0,
      grade: summary?.grade ?? '',
      message: summary?.message ?? '',
      metrics,
      findings,
      recommendations,
    };
  });

  /** Findings agrupados por kind+severity, con conteo y waypoints. */
  protected readonly groupedFindings = computed(() => {
    const map = new Map<string, {
      kind: string;
      severity: string;
      count: number;
      waypoints: number[];
      message: string;
    }>();

    for (const f of this.pa.findings()) {
      const key = `${f.severity}::${f.kind}`;
      let g = map.get(key);
      if (!g) {
        g = { kind: f.kind, severity: f.severity, count: 0, waypoints: [], message: f.message };
        map.set(key, g);
      }
      g.count++;
      if (f.waypoint != null) {
        g.waypoints.push(f.waypoint);
      }
    }

    // Sort: errors first, then warnings, then info
    const severityOrder = { error: 0, warning: 1, info: 2 };
    return Array.from(map.values()).sort(
      (a, b) => (severityOrder[a.severity as keyof typeof severityOrder] ?? 9)
                - (severityOrder[b.severity as keyof typeof severityOrder] ?? 9),
    );
  });

  // ── Plan Analysis actions ──

  protected onPlanFindingClick(waypoint: number | null): void {
    if (waypoint == null) return;

    this.focus.focusWaypoint(waypoint);

    // Expandir el segmento que contiene este waypoint en el editor de planning
    const segments = this.scene.state().activePlan?.segments;
    if (segments) {
      const segIdx = segments.findIndex(
        s => waypoint >= s.waypointStart && waypoint < s.waypointEnd,
      );
      if (segIdx >= 0) {
        this.planning.expandSegment(segIdx);
      }
    }
  }

  protected onApplyRecommendation(r: RecommendationDto): void {
    const action = suggestionKindToAction(r.kind, r.waypoint);
    this.actions.dispatch(action);
  }

  protected iconFor(severity: string): string {
    switch (severity) {
      case 'error': return '\u2715';
      case 'warning': return '\u26A0';
      case 'info': return '\u2139';
      default: return '\u2022';
    }
  }

  // ── Log ──

  protected readonly logEntries = computed(() => this.log.entries());
}
