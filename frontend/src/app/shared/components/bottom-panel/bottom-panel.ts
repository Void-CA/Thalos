import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { SceneStore } from '../../../features/scene/store/scene.store';
import { WorkspaceStore } from '../../../features/workspace/store/workspace.store';
import { PlanAnalysisStore } from '../../../features/plan-analysis/store/plan-analysis.store';
import { FocusService } from '../../services/focus.service';
import { PlanningStore } from '../../store/planning.store';
import { LogStore } from '../../store/log.store';
import { LayoutStore } from '../../store/layout.store';
import { PerspectiveStore } from '../../store/perspective.store';
import { ExecutionCharts } from '../../../features/execution/execution-charts';
import { AlternativesPanel } from '../../../features/plan-analysis/components/alternatives-panel';
import { SessionApiService } from '../../api/session-api.service';

type TabId = 'snapshot' | 'analysis' | 'timeline' | 'plan-analysis'
  | 'log' | 'charts' | 'alt'
  | 'execution-summary' | 'execution-findings' | 'reasoning';

const ALL_TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'snapshot', label: 'Snapshot', icon: 'heroCamera' },
  { id: 'analysis', label: 'Analysis', icon: 'heroChartBar' },
  { id: 'timeline', label: 'Timeline', icon: 'heroClock' },
  { id: 'plan-analysis', label: 'Plan Analysis', icon: 'heroClipboardDocumentCheck' },
  { id: 'log', label: 'Log', icon: 'heroDocumentText' },
  { id: 'charts', label: 'Telemetry', icon: 'heroChartBar' },
  { id: 'alt', label: 'Alternatives', icon: 'heroAdjustmentsVertical' },
  { id: 'execution-summary', label: 'Summary', icon: 'heroClipboardDocumentCheck' },
  { id: 'execution-findings', label: 'Findings', icon: 'heroAdjustmentsVertical' },
  { id: 'reasoning', label: 'Reasoning', icon: 'heroRectangleGroup' },
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
  imports: [NgIcon, ExecutionCharts, AlternativesPanel],
  template: `
    <div class="bottom-panel" [class.bottom-panel--collapsed]="layout.bottomCollapsed()">
      @if (!layout.bottomCollapsed()) {
        <div class="bottom-panel__tabs">
          @for (t of tabs(); track t.id) {
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
              @if (t.id === 'execution-findings') {
                @let badge = executionFindingsBadge();
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

        <!-- Pipeline Flow Monitor -->
        <div class="bottom-panel__pipeline">
          @for (stage of pipelineStages(); track stage.id) {
            <span class="pipeline__stage" [class.pipeline__stage--done]="stage.done" [class.pipeline__stage--active]="stage.active">
              @if (stage.done) { ✅ } @else if (stage.active) { ⏳ } @else { ○ }
              {{ stage.label }}
            </span>
            @if (!$last) { <span class="pipeline__arrow">→</span> }
          }
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

          @if (activeTab() === 'execution-summary') {
            @let es = executionSummary();
            @if (!es) {
              <p class="bottom-panel__empty">No execution data. Start an execution from the Active Plan panel.</p>
            } @else {
              <div class="exec-summary">
                <div class="exec-summary__header">
                  <span class="exec-summary__badge" [class]="'badge--' + es.statusClass">{{ es.statusLabel }}</span>
                  <span class="exec-summary__id">{{ es.planId }}</span>
                  <span class="exec-summary__type">{{ es.motionType }}</span>
                </div>

                <div class="exec-summary__stats">
                  <div class="exec-summary__stat">
                    <span class="exec-summary__stat-value">{{ es.duration }}</span>
                    <span class="exec-summary__stat-label">Duration</span>
                  </div>
                  <div class="exec-summary__stat">
                    <span class="exec-summary__stat-value">{{ es.waypoints }}</span>
                    <span class="exec-summary__stat-label">Waypoints</span>
                  </div>
                  <div class="exec-summary__stat">
                    <span class="exec-summary__stat-value">{{ es.planFindings }}</span>
                    <span class="exec-summary__stat-label">Plan findings</span>
                  </div>
                  <div class="exec-summary__stat">
                    <span class="exec-summary__stat-value">{{ es.execFindings }}</span>
                    <span class="exec-summary__stat-label">Exec findings</span>
                  </div>
                </div>

                @if (es.execCompleted) {
                  <div class="exec-summary__status">
                    <span class="exec-summary__status-icon">✅</span>
                    <span>Execution completed</span>
                  </div>
                  @if (es.planFindingsCount > 0 || es.execFindingsCount > 0) {
                    <div class="exec-summary__recommendation">
                      @if (es.execFindingsCount > 0) {
                        <span>Review execution findings for details.</span>
                      }
                    </div>
                  }
                }
              </div>
            }
          }

          @if (activeTab() === 'execution-findings') {
            @let ef = executionFindings();
            @if (ef.length === 0) {
              <p class="bottom-panel__empty">
                No execution findings yet. After running a comparison, findings will appear here.
              </p>
            } @else {
              <div class="exec-findings">
                <section class="exec-findings__list">
                  <h4 class="exec-findings__title">Execution Findings ({{ ef.length }})</h4>
                  <div class="exec-findings__groups">
                    @for (g of ef; track g.kind) {
                      <details class="exec-findings__group" open>
                        <summary class="exec-findings__group-header">
                          <span class="exec-findings__group-sev">{{ iconFor(g.severity) }}</span>
                          <span class="exec-findings__group-kind">{{ g.kind.replace(/_/g, ' ') }}</span>
                          <span class="exec-findings__category-badge" [style.background]="g.categoryColor">{{ g.categoryLabel }}</span>
                          <span class="exec-findings__group-count" [class]="'count--' + g.severity">{{ g.count }}</span>
                        </summary>
                        <div class="exec-findings__group-body">
                          <p class="exec-findings__group-msg">{{ g.message }}</p>
                          @if (g.value != null) {
                            <span class="exec-findings__group-value">Value: {{ g.value.toFixed(4) }}</span>
                          }
                        </div>
                      </details>
                    }
                  </div>
                </section>
              </div>
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
                @if (plan.comparison; as cmp) {
                  <div class="tl__comparison">
                    <span class="tl__cmp-label">Comparison</span>
                    <span class="tl__cmp-metric">RMSE: {{ cmp.rmse.toFixed(4) }} rad</span>
                    <span class="tl__cmp-metric">Max: {{ cmp.maxError.toFixed(4) }} rad</span>
                    <span class="tl__cmp-metric">Points: {{ cmp.alignedCount }}</span>
                  </div>
                }
              </div>
            }
          }

          @if (activeTab() === 'charts') {
            <execution-charts />
          }

          @if (activeTab() === 'alt') {
            <alternatives-panel />
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
                      <span class="plan-analysis__metric plan-analysis__metric--warn">&#x26D4; {{ m.singular_count }} singular waypoints</span>
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
                              <span class="plan-analysis__category-badge" [style.background]="g.categoryColor">{{ g.categoryLabel }}</span>
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

              </div>
            } @else {
              <p class="bottom-panel__empty">
                Compile a plan in <strong>Planning</strong> mode to see analysis results.
              </p>
            }
          }

          @if (activeTab() === 'reasoning') {
            @let r = reasoningState();
            <div class="reasoning">
              <div class="reasoning__section">
                <h4 class="reasoning__section-title">Planning Findings ({{ r.planFindingsCount }})</h4>
                <div class="reasoning__list">
                  @for (f of r.planFindings; track $index) {
                    <div class="reasoning__item">
                      <span class="reasoning__item-sev {{ 'sev--' + f.severity }}">{{ iconFor(f.severity) }}</span>
                      <span class="reasoning__item-kind">{{ f.kind }}</span>
                      <span class="reasoning__item-category" [style.background]="f.catColor">{{ f.catLabel }}</span>
                      @if (f.waypoint != null) {
                        <span class="reasoning__item-wp">wp{{ f.waypoint }}</span>
                      }
                    </div>
                  }
                </div>
              </div>

              <div class="reasoning__section">
                <h4 class="reasoning__section-title">Execution Findings ({{ r.execFindingsCount }})</h4>
                <div class="reasoning__list">
                  @for (f of r.execFindings; track $index) {
                    <div class="reasoning__item">
                      <span class="reasoning__item-sev {{ 'sev--' + f.severity }}">{{ iconFor(f.severity) }}</span>
                      <span class="reasoning__item-kind">{{ f.kind }}</span>
                      <span class="reasoning__item-category" [style.background]="f.catColor">{{ f.catLabel }}</span>
                      <span class="reasoning__item-val">{{ f.value?.toFixed(3) }}</span>
                    </div>
                  }
                  @if (r.execFindingsCount === 0) {
                    <span class="reasoning__empty">No execution findings yet. Run a comparison first.</span>
                  }
                </div>
              </div>

              <div class="reasoning__section">
                <h4 class="reasoning__section-title">ProblemRegions</h4>
                <div class="reasoning__list">
                  @for (rgn of r.problemRegions; track $index) {
                    <div class="reasoning__item">
                      <span class="reasoning__item-wp">wp{{ rgn.waypoint }}</span>
                      <span class="reasoning__item-category" [style.background]="rgn.catColor">{{ rgn.catLabel }}</span>
                      <span class="reasoning__item-sev {{ 'sev--' + rgn.severity }}">{{ rgn.severity }}</span>
                    </div>
                  }
                  @if (r.problemRegions.length === 0) {
                    <span class="reasoning__empty">No problem regions. No findings to derive from.</span>
                  }
                </div>
              </div>

              <div class="reasoning__section">
                <h4 class="reasoning__section-title">ExecutionThresholds</h4>
                <div class="reasoning__thresholds">
                  <span class="reasoning__threshold">RMSE warn: 0.05 rad</span>
                  <span class="reasoning__threshold">Spike warn: 0.10 rad</span>
                  <span class="reasoning__threshold">Joint warn: 0.10 rad</span>
                  <span class="reasoning__threshold">Velocity warn: 1.0 rad/s</span>
                </div>
              </div>
            </div>
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
  private readonly planning = inject(PlanningStore);
  protected readonly log = inject(LogStore);
  protected readonly layout = inject(LayoutStore);
  private readonly perspective = inject(PerspectiveStore);

  /** Tabs visibles según la perspectiva activa. */
  protected readonly tabs = computed(() => {
    const config = this.perspective.config();
    const tabIds = new Set(config.bottomTabs.map(t => t.id));
    return ALL_TABS.filter(t => tabIds.has(t.id));
  });

  /** Resetear activeTab si la tab activa ya no está en las visibles. */
  private readonly _syncActiveTab = effect(() => {
    const config = this.perspective.config();
    const tabIds = new Set(config.bottomTabs.map(t => t.id));
    if (!tabIds.has(this.activeTab())) {
      const current = this.tabs();
      const first = current.length > 0 ? current[0].id : 'log';
      this.activeTab.set(first);
    }
  });

  protected readonly activeTab = signal<TabId>(
    this.perspective.perspective() === 'execution' ? 'execution-summary' : 'timeline',
  );

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
      comparison: null as { rmse: number; maxError: number; alignedCount: number } | null,
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

  /** Findings agrupados por kind+severity, con conteo, waypoints y categoría. */
  protected readonly groupedFindings = computed(() => {
    const map = new Map<string, {
      kind: string;
      severity: string;
      count: number;
      waypoints: number[];
      message: string;
      categoryLabel: string;
      categoryColor: string;
    }>();

    for (const f of this.pa.findings()) {
      const key = `${f.severity}::${f.kind}`;
      let g = map.get(key);
      if (!g) {
        const cat = this.findingCategory(f.kind);
        g = {
          kind: f.kind, severity: f.severity, count: 0,
          waypoints: [], message: f.message,
          categoryLabel: cat.label, categoryColor: cat.color,
        };
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

  // ── Reasoning Inspector ──

  protected readonly reasoningState = computed(() => {
    const planFindings = this.pa.findings().map(f => ({
      kind: f.kind,
      severity: f.severity,
      waypoint: f.waypoint,
      value: f.value,
      catLabel: this.findingCategory(f.kind).label,
      catColor: this.findingCategory(f.kind).color,
    }));

    // Execution findings: derive from available data (placeholder for endpoint data)
    const execFindingsRaw = this.pa.findings().filter(f =>
      ['tracking_error', 'tracking_spike', 'joint_deviation', 'velocity_deviation'].includes(f.kind)
    );
    const execFindings = execFindingsRaw.map(f => ({
      kind: f.kind,
      severity: f.severity,
      value: f.value,
      catLabel: this.findingCategory(f.kind).label,
      catColor: this.findingCategory(f.kind).color,
    }));

    // ProblemRegions: derived from waypoint findings
    const wpFindings = this.pa.findings().filter(f => f.waypoint != null);
    const regionMap = new Map<string, { waypoint: number; severity: string; catLabel: string; catColor: string }>();
    for (const f of wpFindings) {
      if (f.waypoint == null) continue;
      const cat = this.findingCategory(f.kind);
      const key = `wp${f.waypoint}::${cat.label}`;
      if (!regionMap.has(key)) {
        regionMap.set(key, {
          waypoint: f.waypoint,
          severity: f.severity,
          catLabel: cat.label,
          catColor: cat.color,
        });
      }
    }
    const problemRegions = Array.from(regionMap.values());

    return {
      planFindingsCount: planFindings.length,
      execFindingsCount: execFindings.length,
      planFindings,
      execFindings,
      problemRegions,
    };
  });

  // ── Pipeline Flow Monitor ──

  /** Estado de cada etapa del pipeline Thalos. */
  protected readonly pipelineStages = computed(() => {
    const state = this.scene.state();
    const plan = state.activePlan;
    const exe = state.execution;
    const paHasResult = this.pa.hasResult();

    return [
      { id: 'plan', label: 'Plan', done: !!plan, active: !!plan && !exe },
      { id: 'execute', label: 'Execute', done: exe?.status === 'Completed' || exe?.status === 'Failed' || exe?.status === 'Cancelled', active: exe?.status === 'Active' },
      { id: 'compare', label: 'Compare', done: false, active: false },
      { id: 'knowledge', label: 'Knowledge', done: paHasResult || !!exe, active: paHasResult && !!exe },
      { id: 'improve', label: 'Improve', done: false, active: false },
    ];
  });

  // ── Execution Summary ──

  protected readonly executionSummary = computed(() => {
    const state = this.scene.state();
    const plan = state.activePlan;
    const exe = state.execution;
    if (!plan || !exe) return null;

    const statusClass = exe.status === 'Completed' ? 'ok'
      : exe.status === 'Failed' ? 'error'
      : exe.status === 'Active' ? 'active'
      : exe.status === 'Paused' ? 'warn'
      : 'default';

    return {
      planId: plan.planId,
      statusLabel: exe.status,
      statusClass,
      motionType: plan.motionType,
      duration: exe.elapsedSecs ? `${exe.elapsedSecs.toFixed(1)}s` : '—',
      waypoints: plan.visualization?.waypoints.length ?? 0,
      planFindings: `${this.pa.findings().length}`,
      execFindings: '—',
      execCompleted: exe.status === 'Completed',
      planFindingsCount: this.pa.findings().length,
      execFindingsCount: 0,
    };
  });

  // ── Execution Findings (Sprint 1: placeholders from available data) ──

  /** Mapea un FindingKind a categoría visual. */
  protected findingCategory(kind: string): { label: string; color: string } {
    switch (kind) {
      case 'collision': case 'collision_near': return { label: 'Collision', color: '#ef4444' };
      case 'low_manipulability': case 'near_singularity': case 'singularity': case 'ik_suggestion':
        return { label: 'Kinematic', color: '#eab308' };
      case 'tracking_error': case 'tracking_spike': case 'joint_deviation':
        return { label: 'Tracking', color: '#f97316' };
      case 'velocity_deviation': return { label: 'Velocity', color: '#3b82f6' };
      case 'constraint_violation': return { label: 'Constraint', color: '#a855f7' };
      default: return { label: 'Unknown', color: '#6b7280' };
    }
  }

  /** Hallazgos de ejecución — en Sprint 1 solo planning findings con categoría; en Sprint 2+ se suman execution findings. */
  protected readonly executionFindings = computed(() => {
    // Por ahora, mostrar planning findings con categoría como preview.
    // En Sprint 2, esto se reemplaza con findings del endpoint /sessions/{id}/comparison
    const findings = this.pa.findings();
    if (findings.length === 0) return [];

    const map = new Map<string, {
      kind: string;
      severity: string;
      count: number;
      message: string;
      value: number | null;
      categoryLabel: string;
      categoryColor: string;
    }>();

    for (const f of findings) {
      const key = `${f.severity}::${f.kind}`;
      let g = map.get(key);
      if (!g) {
        const cat = this.findingCategory(f.kind);
        g = {
          kind: f.kind, severity: f.severity, count: 0,
          message: f.message, value: f.value ?? null,
          categoryLabel: cat.label, categoryColor: cat.color,
        };
        map.set(key, g);
      }
      g.count++;
      if (!g.message) g.message = f.message;
    }

    const severityOrder = { error: 0, warning: 1, info: 2 };
    return Array.from(map.values()).sort(
      (a, b) => (severityOrder[a.severity as keyof typeof severityOrder] ?? 9)
                - (severityOrder[b.severity as keyof typeof severityOrder] ?? 9),
    );
  });

  /** Badge para la pestaña Execution Findings. */
  protected readonly executionFindingsBadge = computed<{ kind: string; label: string } | null>(() => {
    const findings = this.executionFindings();
    if (findings.length === 0) return null;

    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;

    if (errors > 0) return { kind: 'error', label: `\u2715 ${errors}` };
    if (warnings > 0) return { kind: 'warn', label: `\u26A0 ${warnings}` };
    return { kind: 'info', label: `\u2139 ${findings.length}` };
  });
}
