import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { SceneStore } from '../../../features/scene/store/scene.store';
import { WorkspaceStore } from '../../../features/workspace/store/workspace.store';
import { LayoutStore } from '../../store/layout.store';

type TabId = 'snapshot' | 'analysis' | 'timeline' | 'log';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'snapshot', label: 'Snapshot', icon: 'heroCamera' },
  { id: 'analysis', label: 'Analysis', icon: 'heroChartBar' },
  { id: 'timeline', label: 'Timeline', icon: 'heroClock' },
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

  // ── Log ──

  protected readonly logEntries = computed(() => {
    const entries: Array<{ time: string; level: string; msg: string }> = [];
    const state = this.scene.state();
    if (state?.ui?.error) {
      entries.push({ time: new Date().toLocaleTimeString(), level: 'error', msg: state.ui.error });
    }
    return entries;
  });
}
