import { Component, computed, inject, signal, NgTemplateOutlet } from '@angular/core';
import { SceneStore } from '../../../features/scene/store/scene.store';
import { LayoutStore } from '../../store/layout.store';

type TabId = 'snapshot' | 'timeline' | 'log';

const TABS: { id: TabId; label: string }[] = [
  { id: 'snapshot', label: 'Snapshot' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'log', label: 'Log' },
];

/** Segment color palette (matches planning-panel colors). */
const SEGMENT_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

/**
 * Bottom panel — system observability in tabs.
 *
 * Tabs:
 *   - Snapshot: runtime state summary (replaces the raw JSON dump).
 *   - Timeline: execution progress visualization.
 *   - Log: error messages and system log.
 */
@Component({
  selector: 'bottom-panel',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    <div class="bottom-panel" [class.bottom-panel--collapsed]="layout.bottomCollapsed()">
      @if (!layout.bottomCollapsed()) {
        <!-- ── Tab bar ── -->
        <div class="bottom-panel__tabs">
          @for (t of tabs; track t.id) {
            <button
              class="bottom-panel__tab"
              [class.bottom-panel__tab--active]="activeTab() === t.id"
              (click)="activeTab.set(t.id)"
            >
              {{ t.label }}
            </button>
          }

          <span class="bottom-panel__spacer"></span>

          <!-- Collapse -->
          <button
            class="bottom-panel__collapse"
            (click)="layout.toggleBottom()"
            title="Collapse panel"
          >▼</button>
        </div>

        <!-- ── Tab content ── -->
        <div class="bottom-panel__content">
          @switch (activeTab()) {
            @case ('snapshot') { <ng-container *ngTemplateOutlet="snapshotTmpl" /> }
            @case ('timeline') { <ng-container *ngTemplateOutlet="timelineTmpl" /> }
            @case ('log')      { <ng-container *ngTemplateOutlet="logTmpl" /> }
          }
        </div>
      } @else {
        <!-- Collapsed stub — just a thin bar with expand button -->
        <div class="bottom-panel__stub">
          <button
            class="bottom-panel__expand"
            (click)="layout.toggleBottom()"
            title="Expand panel"
          >▲</button>
        </div>
      }
    </div>

    <!-- ── Snapshot template ── -->
    <ng-template #snapshotTmpl>
      <pre class="bottom-panel__json">{{ snapshotJson() }}</pre>
    </ng-template>

    <!-- ── Timeline template ── -->
    <ng-template #timelineTmpl>
      @let plan = tlPlan();
      @if (!plan) {
        <p class="bottom-panel__empty">No active plan. Compile a program in Planning mode to see timeline.</p>
      } @else {
        <div class="tl">
          <!-- Plan identity -->
          <div class="tl__header">
            <span class="tl__badge" [style.--badge-color]="plan.badgeColor">{{ plan.stateLabel }}</span>
            <span class="tl__id">{{ plan.planId }}</span>
            <span class="tl__type">{{ plan.motionType }}</span>
          </div>

          <!-- Segments bar (multi-colored when segments present) -->
          @if (plan.segments.length > 0) {
            <div class="tl__segments">
              @for (seg of plan.segments; track seg.index) {
                <div
                  class="tl__segment"
                  [style.width.%]="seg.pct"
                  [style.background]="seg.color"
                  [title]="seg.label"
                >
                  <span class="tl__segment-label">{{ seg.label }}</span>
                </div>
              }
            </div>
          }

          <!-- Main progress bar -->
          <div class="tl__progress">
            <div class="tl__progress-track">
              <div
                class="tl__progress-fill"
                [style.width.%]="plan.progressPct"
                [style.background]="plan.fillColor"
              ></div>
              @if (plan.progressPct > 0 && plan.progressPct < 100) {
                <div class="tl__marker" [style.left.%]="plan.progressPct"></div>
              }
            </div>
            <span class="tl__pct">{{ plan.progressPct }}%</span>
          </div>

          <!-- Timing info -->
          <div class="tl__times">
            <span class="tl__time">Elapsed: {{ plan.elapsed }}</span>
            @if (plan.duration) {
              <span class="tl__time">Total: {{ plan.duration }}</span>
            }
          </div>

          <!-- Waypoints strip -->
          @if (plan.waypointCount > 0) {
            <div class="tl__wpts">
              @for (wp of plan.wpPositions; track $index) {
                <span
                  class="tl__wpt"
                  [style.left.%]="wp.pct"
                  [title]="wp.label"
                  [class.tl__wpt--start]="wp.type === 'Start'"
                  [class.tl__wpt--goal]="wp.type === 'Goal'"
                  [class.tl__wpt--via]="wp.type === 'Via'"
                ></span>
              }
            </div>
          }

          <!-- LIVE indicator -->
          @if (plan.isLive) {
            <span class="tl__live">● LIVE</span>
          }
        </div>
      }
    </ng-template>

    <!-- ── Log template ── -->
    <ng-template #logTmpl>
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
    </ng-template>
  `,
  styleUrl: './bottom-panel.scss',
})
export class BottomPanel {
  protected readonly scene = inject(SceneStore);
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
          ? {
              status: exe.status,
              progress: exe.progress,
              elapsedSecs: exe.elapsedSecs,
            }
          : null,
        generatedAt: state.runtime.generatedAt,
      },
      null,
      2,
    );
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
      Created: '#ffaa33',
      Active: '#33ccff',
      Paused: '#ffaa33',
      Completed: '#44cc44',
      Cancelled: '#cc4444',
      Failed: '#cc4444',
    };

    const fillColorMap: Record<string, string> = {
      Created: '#ffaa33',
      Active: '#33ccff',
      Paused: '#ffaa33',
      Completed: '#44cc44',
      Cancelled: '#666',
      Failed: '#cc4444',
    };

    const segments = plan.segments?.map((seg, i) => ({
      index: seg.segmentIndex,
      pct: seg.waypointEnd - seg.waypointStart,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      label: `${seg.motionType} [${seg.timeStart.toFixed(1)}s-${seg.timeEnd.toFixed(1)}s]`,
    })) ?? [];

    const waypoints = plan.visualization?.waypoints ?? [];
    const duration = waypoints.length > 0
      ? waypoints[waypoints.length - 1].timestamp
      : null;

    const wpPositions = waypoints.map((wp, _i) => ({
      pct: duration && duration > 0 ? Math.round((wp.timestamp / duration) * 100) : 0,
      label: `${wp.waypointType} @ ${wp.timestamp.toFixed(2)}s`,
      type: wp.waypointType,
    }));

    return {
      planId: plan.planId,
      stateLabel: effectiveState,
      badgeColor: badgeColorMap[effectiveState] ?? '#888',
      fillColor: fillColorMap[effectiveState] ?? '#888',
      motionType: plan.motionType,
      progress,
      progressPct,
      segments,
      waypointCount: waypoints.length,
      wpPositions,
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
      entries.push({
        time: new Date().toLocaleTimeString(),
        level: 'error',
        msg: state.ui.error,
      });
    }

    return entries;
  });
}
