import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { SceneStore } from '../../scene/store/scene.store';
import { SceneApiService } from '../../scene/services/scene-api.service';
import { LogStore } from '../../../shared/store/log.store';
import { ExecutionCharts } from '../execution-charts';

type SimTab = 'playback' | 'charts' | 'log';
type ExecAction = 'start' | 'pause' | 'resume' | 'cancel' | 'reset';

const SEGMENT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const TICK_INTERVAL = 50;
const TICK_DT = TICK_INTERVAL / 1000;

/**
 * Simulation Workspace — timeline y playback en primer plano.
 * El viewport 3D está a la izquierda (manejado por el shell).
 */
@Component({
  selector: 'simulation-workspace',
  standalone: true,
  imports: [ExecutionCharts],
  template: `
    <div class="sw">
      <header class="sw__header">
        <h1 class="sw__title">Simulation</h1>
      </header>

      <nav class="sw__tabs">
        @for (t of tabs; track t.id) {
          <button class="sw__tab" [class.sw__tab--active]="activeTab() === t.id" (click)="activeTab.set(t.id)">{{ t.label }}</button>
        }
      </nav>

      @if (activeTab() === 'playback') {
        @let plan = tlPlan();
        @if (!plan) {
          <div class="sw__empty">
            <p>No active plan. Compile a program in <strong>Planning</strong> mode.</p>
          </div>
        } @else {
          <!-- Progress -->
          <section class="sw__section">
            <div class="sw__progress-row">
              <div class="sw__progress-track">
                <div class="sw__progress-fill" [style.width.%]="plan.progressPct" [style.background]="plan.fillColor"></div>
                @if (plan.progressPct > 0 && plan.progressPct < 100) {
                  <div class="sw__marker" [style.left.%]="plan.progressPct"></div>
                }
              </div>
              <span class="sw__pct">{{ plan.progressPct }}%</span>
            </div>
            <div class="sw__times">
              <span>Elapsed: {{ plan.elapsed }}</span>
              @if (plan.duration) { <span>Total: {{ plan.duration }}</span> }
            </div>
          </section>

          <!-- Segments -->
          @if (plan.segments.length > 0) {
            <section class="sw__section">
              <div class="sw__segments-bar">
                @for (seg of plan.segments; track seg.index) {
                  <div class="sw__segment" [style.width.%]="seg.pct" [style.background]="seg.color" [title]="seg.label">
                    <span class="sw__seg-label">{{ seg.label }}</span>
                  </div>
                }
              </div>
            </section>
          }

          <!-- Controls -->
          <section class="sw__section">
            <div class="sw__controls">
              @if (plan.canStart) {
                <button class="sw__ctrl sw__ctrl--start" (click)="doAction('start')" [disabled]="loading()">▶ Start</button>
              }
              @if (plan.canPause) {
                <button class="sw__ctrl sw__ctrl--pause" (click)="doAction('pause')" [disabled]="loading()">⏸ Pause</button>
              }
              @if (plan.canResume) {
                <button class="sw__ctrl sw__ctrl--resume" (click)="doAction('resume')" [disabled]="loading()">▶ Resume</button>
              }
              @if (plan.canCancel) {
                <button class="sw__ctrl sw__ctrl--stop" (click)="doAction('cancel')" [disabled]="loading()">⏹ Stop</button>
              }
              @if (plan.canReset) {
                <button class="sw__ctrl sw__ctrl--reset" (click)="doAction('reset')" [disabled]="loading()">↺ Reset</button>
              }
              @if (plan.isLive) {
                <span class="sw__live">● LIVE</span>
              }
            </div>
          </section>

          <!-- Waypoints strip -->
          @if (plan.wpPositions.length > 0) {
            <section class="sw__section">
              <div class="sw__wpts-strip">
                @for (wp of plan.wpPositions; track $index) {
                  <div class="sw__wpt" [style.left.%]="wp.pct" [title]="wp.label"
                    [class.sw__wpt--start]="wp.type === 'Start'"
                    [class.sw__wpt--goal]="wp.type === 'Goal'"
                    [class.sw__wpt--via]="wp.type === 'Via'"></div>
                }
              </div>
            </section>
          }

          <!-- Live metrics -->
          <section class="sw__section">
            <div class="sw__metrics">
              <div class="sw__metric">
                <span class="sw__metric-lbl">Status</span>
                <span class="sw__metric-val" [class.sw__metric--live]="plan.isLive">{{ plan.stateLabel }}</span>
              </div>
              <div class="sw__metric">
                <span class="sw__metric-lbl">Progress</span>
                <span class="sw__metric-val">{{ plan.progressPct }}%</span>
              </div>
              <div class="sw__metric">
                <span class="sw__metric-lbl">Elapsed</span>
                <span class="sw__metric-val">{{ plan.elapsed }}</span>
              </div>
              @if (plan.duration) {
                <div class="sw__metric">
                  <span class="sw__metric-lbl">Duration</span>
                  <span class="sw__metric-val">{{ plan.duration }}</span>
                </div>
              }
              <div class="sw__metric">
                <span class="sw__metric-lbl">Waypoints</span>
                <span class="sw__metric-val">{{ plan.waypointCount }}</span>
              </div>
              <div class="sw__metric">
                <span class="sw__metric-lbl">Motion</span>
                <span class="sw__metric-val">{{ plan.motionType }}</span>
              </div>
            </div>
          </section>

          <!-- Comparison -->
          @if (plan.comparison) {
            <section class="sw__section">
              <div class="sw__comparison">
                <span class="sw__cmp-title">Plan vs Execution</span>
                <div class="sw__cmp-metrics">
                  <span class="sw__cmp-item">RMSE: <strong>{{ plan.comparison.rmse.toFixed(4) }}</strong> rad</span>
                  <span class="sw__cmp-item">Max: <strong>{{ plan.comparison.maxError.toFixed(4) }}</strong> rad</span>
                  <span class="sw__cmp-item">Points: {{ plan.comparison.alignedCount }}</span>
                </div>
              </div>
            </section>
          }
        }
      }

      @if (activeTab() === 'charts') {
        <section class="sw__section sw__section--fill">
          <execution-charts />
        </section>
      }

      @if (activeTab() === 'log') {
        <section class="sw__section sw__section--fill">
          <div class="sw__log">
            @let entries = logEntries();
            @if (entries.length === 0) {
              <p class="sw__empty">No log entries.</p>
            } @else {
              @for (entry of entries; track entry.time) {
                <div class="sw__log-entry" [class.sw__log-entry--error]="entry.level === 'error'">
                  <span class="sw__log-time">{{ entry.time }}</span>
                  <span class="sw__log-level">{{ entry.level }}</span>
                  <span class="sw__log-msg">{{ entry.msg }}</span>
                </div>
              }
            }
          </div>
        </section>
      }
    </div>
  `,
  styleUrl: './simulation-workspace.scss',
})
export class SimulationWorkspace implements OnDestroy {
  protected readonly tabs = [
    { id: 'playback' as const, label: 'Playback' },
    { id: 'charts' as const, label: 'Charts' },
    { id: 'log' as const, label: 'Log' },
  ];
  protected readonly activeTab = signal<SimTab>('playback');

  private readonly scene = inject(SceneStore);
  private readonly api = inject(SceneApiService);
  protected readonly log = inject(LogStore);

  protected readonly loading = signal(false);
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  ngOnDestroy(): void {
    this.stopTickLoop();
  }

  

  protected readonly tlPlan = computed(() => {
    const state = this.scene.state();
    const plan = state?.activePlan;
    const exe = state?.execution;
    if (!plan) return null;

    const effectiveState = exe?.status ?? plan.state;
    const progress = exe?.progress ?? plan.trajectoryProgress ?? 0;
    const progressPct = Math.round(progress * 100);

    const fillColorMap: Record<string, string> = {
      Created: '#b8943a', Active: '#4a8ab5', Paused: '#b8943a',
      Completed: '#4a9e5a', Cancelled: '#6a7a8a', Failed: '#b85450',
    };

    const segments = plan.segments?.map((seg, i) => ({
      index: seg.segmentIndex,
      pct: seg.waypointEnd - seg.waypointStart,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      label: `${seg.motionType} [${seg.timeStart.toFixed(1)}s-${seg.timeEnd.toFixed(1)}s]`,
    })) ?? [];

    const waypoints = plan.visualization?.waypoints ?? [];
    const duration = waypoints.length > 0 ? waypoints[waypoints.length - 1].timestamp : null;
    const wpPositions = waypoints.map(wp => ({
      pct: duration && duration > 0 ? Math.round((wp.timestamp / duration) * 100) : 0,
      label: `${wp.waypointType} @ ${wp.timestamp.toFixed(2)}s`,
      type: wp.waypointType,
    }));

    const canStart = plan.state === 'Created' && (!exe || exe.status === 'Idle');
    const canPause = exe?.status === 'Active';
    const canResume = exe?.status === 'Paused';
    const canCancel = exe?.status === 'Active' || exe?.status === 'Paused';
    const canReset = exe?.status === 'Completed' || exe?.status === 'Cancelled' || exe?.status === 'Failed' || (!exe && plan.state === 'Created');

    return {
      planId: plan.planId,
      stateLabel: effectiveState,
      fillColor: fillColorMap[effectiveState] ?? '#6a7a8a',
      motionType: plan.motionType,
      progress,
      progressPct,
      segments,
      waypointCount: waypoints.length,
      wpPositions,
      elapsed: exe?.elapsedSecs != null ? `${exe.elapsedSecs.toFixed(1)}s` : '—',
      duration: duration != null ? `${duration.toFixed(1)}s` : null,
      isLive: effectiveState === 'Active',
      canStart, canPause, canResume, canCancel, canReset,
      comparison: null as { rmse: number; maxError: number; alignedCount: number } | null,
    };
  });

  protected readonly logEntries = computed(() => this.log.entries());

  

  protected doAction(action: ExecAction): void {
    this.loading.set(true);
    const request$ = (() => {
      switch (action) {
        case 'start':  return this.api.startExecution();
        case 'pause':  return this.api.pauseExecution();
        case 'resume': return this.api.resumeExecution();
        case 'cancel': return this.api.cancelExecution();
        case 'reset':  return this.api.resetExecution();
      }
    })();

    request$.subscribe({
      next: res => {
        this.scene.applySnapshot(res);
        this.loading.set(false);
        if (action === 'start' || action === 'resume') this.startTickLoop();
        if (action === 'pause' || action === 'cancel' || action === 'reset') this.stopTickLoop();
      },
      error: () => this.loading.set(false),
    });
  }

  private startTickLoop(): void {
    this.stopTickLoop();
    this.tickTimer = setInterval(() => this.onTick(), TICK_INTERVAL);
  }

  private stopTickLoop(): void {
    if (this.tickTimer !== null) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  private onTick(): void {
    const status = this.scene.state()?.execution?.status ?? this.scene.state()?.activePlan?.state;
    if (status !== 'Active') { this.stopTickLoop(); return; }
    this.api.tickExecution(TICK_DT).subscribe({
      next: res => this.scene.applyRuntimeDelta(res),
      error: () => this.stopTickLoop(),
    });
  }
}
