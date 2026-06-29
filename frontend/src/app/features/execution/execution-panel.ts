import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { SceneStore } from '../scene/store/scene.store';
import { SceneApiService } from '../scene/services/scene-api.service';

const STATE_COLORS: Record<string, string> = {
  Created: '#ffaa33',
  Active: '#33ccff',
  Paused: '#ffaa33',
  Completed: '#44cc44',
  Cancelled: '#cc4444',
  Failed: '#cc4444',
};

/** How often the frontend polls the execution tick endpoint (ms). */
const TICK_INTERVAL_MS = 50;

/** Seconds to advance per tick (must match TICK_INTERVAL_MS / 1000). */
const TICK_DT = TICK_INTERVAL_MS / 1000;

type ExecutionAction = 'start' | 'pause' | 'resume' | 'cancel' | 'reset';

@Component({
  selector: 'execution-panel',
  standalone: true,
  template: `
    <div class="execution-panel">
      @let plan = planInfo();
      @if (plan) {
        <!-- ── Plan identity header ── -->
        <div class="plan-header">
          <span class="plan-badge" [style.--badge-color]="plan.stateColor">
            {{ plan.stateLabel }}
          </span>
          <span class="plan-id">{{ plan.planId }}</span>
        </div>

        <!-- ── Motion type ── -->
        <div class="plan-row">
          <span class="plan-label">Motion</span>
          <span class="plan-value">{{ plan.motionType }}</span>
        </div>

        <!-- ── Waypoints count ── -->
        @if (plan.waypoints !== null) {
          <div class="plan-row">
            <span class="plan-label">Waypoints</span>
            <span class="plan-value">{{ plan.waypoints }}</span>
          </div>
        }

        <!-- ── Progress bar ── -->
        @if (plan.progress !== null) {
          <div class="plan-progress">
            <span class="plan-label">Progress</span>
            <div class="progress-track">
              <div
                class="progress-fill"
                [style.width.%]="plan.progress * 100"
              ></div>
            </div>
            <span class="plan-value">{{ plan.progressPct }}%</span>
          </div>
        }

        <!-- ── Timestamps ── -->
        <div class="plan-timestamps">
          @if (plan.createdAt) {
            <div class="plan-row">
              <span class="plan-label">Created</span>
              <span class="plan-value">{{ plan.createdAt }}</span>
            </div>
          }
          @if (plan.startedAt) {
            <div class="plan-row">
              <span class="plan-label">Started</span>
              <span class="plan-value">{{ plan.startedAt }}</span>
            </div>
          }
          @if (plan.completedAt) {
            <div class="plan-row">
              <span class="plan-label">Completed</span>
              <span class="plan-value">{{ plan.completedAt }}</span>
            </div>
          }
        </div>

        <!-- ── Execution controls ── -->
        <div class="execution-controls">
          @if (plan.canStart) {
            <button class="ctrl-btn ctrl-btn--start" (click)="doAction('start')" [disabled]="loading()">
              {{ loading() ? '…' : '▶ Start' }}
            </button>
          }
          @if (plan.canPause) {
            <button class="ctrl-btn ctrl-btn--pause" (click)="doAction('pause')" [disabled]="loading()">
              {{ loading() ? '…' : '⏸ Pause' }}
            </button>
          }
          @if (plan.canResume) {
            <button class="ctrl-btn ctrl-btn--resume" (click)="doAction('resume')" [disabled]="loading()">
              {{ loading() ? '…' : '▶ Resume' }}
            </button>
          }
          @if (plan.canCancel) {
            <button class="ctrl-btn ctrl-btn--stop" (click)="doAction('cancel')" [disabled]="loading()">
              {{ loading() ? '…' : '⏹ Stop' }}
            </button>
          }
          @if (plan.canReset) {
            <button class="ctrl-btn ctrl-btn--reset" (click)="doAction('reset')" [disabled]="loading()">
              {{ loading() ? '…' : '↺ Reset' }}
            </button>
          }
        </div>

        <!-- ── Live indicator ── -->
        @if (plan.isLive) {
          <span class="live-indicator">● LIVE</span>
        }
      } @else {
        <p class="empty-state">No active plan</p>
        <p class="empty-state__hint">
          Compile a program in <strong>Planning</strong> mode to see plan details here.
        </p>
      }
    </div>
  `,
  styles: `
    .execution-panel {
      font-family: monospace;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .plan-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .plan-badge {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--badge-color, #666);
      color: #111;
    }

    .plan-id {
      font-size: 0.75rem;
      opacity: 0.7;
    }

    .plan-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.78rem;
    }

    .plan-label {
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.7rem;
    }

    .plan-value {
      font-weight: 600;
    }

    .plan-progress {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.78rem;
    }

    .progress-track {
      flex: 1;
      height: 6px;
      background: #333;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: #33ccff;
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .plan-timestamps {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      border-top: 1px solid #333;
      padding-top: 0.5rem;
    }

    .empty-state {
      text-align: center;
      font-size: 0.78rem;
      opacity: 0.5;
      margin: 1rem 0 0.3rem;
    }

    .empty-state__hint {
      text-align: center;
      font-size: 0.7rem;
      opacity: 0.35;
      margin: 0;
      line-height: 1.4;
    }

    .execution-controls {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
      border-top: 1px solid #333;
      padding-top: 0.5rem;
    }

    .ctrl-btn {
      font-family: monospace;
      font-size: 0.72rem;
      padding: 0.3rem 0.6rem;
      border-radius: 3px;
      border: 1px solid #555;
      background: #222;
      color: #ddd;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .ctrl-btn:hover:not(:disabled) {
      background: #333;
    }

    .ctrl-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .ctrl-btn--start { border-color: #44cc44; color: #44cc44; }
    .ctrl-btn--start:hover:not(:disabled) { background: #1a3a1a; }
    .ctrl-btn--pause { border-color: #ffaa33; color: #ffaa33; }
    .ctrl-btn--pause:hover:not(:disabled) { background: #3a2a1a; }
    .ctrl-btn--resume { border-color: #33ccff; color: #33ccff; }
    .ctrl-btn--resume:hover:not(:disabled) { background: #1a2a3a; }
    .ctrl-btn--stop { border-color: #cc4444; color: #cc4444; }
    .ctrl-btn--stop:hover:not(:disabled) { background: #3a1a1a; }
    .ctrl-btn--reset { border-color: #888; color: #888; }
    .ctrl-btn--reset:hover:not(:disabled) { background: #2a2a2a; }

    .live-indicator {
      font-size: 0.65rem;
      color: #44cc44;
      animation: pulse 1s ease-in-out infinite;
      text-align: center;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `,
})
export class ExecutionPanel implements OnDestroy {
  private readonly store = inject(SceneStore);
  private readonly api = inject(SceneApiService);

  protected readonly loading = signal(false);
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly planInfo = computed(() => {
    const plan = this.store.state().activePlan;
    if (!plan) return null;

    const stateLabel = plan.state;
    const stateColor = STATE_COLORS[plan.state] ?? '#888';
    const progress = plan.trajectoryProgress ?? 0;

    const canStart = plan.state === 'Created';
    const canPause = plan.state === 'Active';
    const canResume = plan.state === 'Paused';
    const canCancel = plan.state === 'Active' || plan.state === 'Paused';
    const canReset = plan.state === 'Completed' || plan.state === 'Cancelled' || plan.state === 'Failed' || plan.state === 'Created';
    const isLive = plan.state === 'Active';

    return {
      planId: plan.planId,
      stateLabel,
      stateColor,
      motionType: plan.motionType,
      waypoints: plan.visualization?.waypoints.length ?? null,
      progress,
      progressPct: Math.round(progress * 100),
      createdAt: plan.createdAt ? new Date(plan.createdAt).toLocaleTimeString() : null,
      startedAt: plan.startedAt ? new Date(plan.startedAt).toLocaleTimeString() : null,
      completedAt: plan.completedAt ? new Date(plan.completedAt).toLocaleTimeString() : null,
      canStart,
      canPause,
      canResume,
      canCancel,
      canReset,
      isLive,
    };
  });

  ngOnDestroy(): void {
    this.stopTickLoop();
  }

  protected doAction(action: ExecutionAction): void {
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
        this.store.applySnapshot(res);
        this.loading.set(false);

        // Start / resume → begin ticking
        if (action === 'start' || action === 'resume') {
          this.startTickLoop();
        }
        // Pause / cancel / reset → stop ticking
        if (action === 'pause' || action === 'cancel' || action === 'reset') {
          this.stopTickLoop();
        }
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  // ── Tick loop ──

  private startTickLoop(): void {
    this.stopTickLoop(); // avoid duplicates
    this.tickTimer = setInterval(() => this.onTick(), TICK_INTERVAL_MS);
  }

  private stopTickLoop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private onTick(): void {
    // Re-check state — if not running anymore, stop ticking
    const state = this.store.state().activePlan?.state;
    if (state !== 'Active') {
      this.stopTickLoop();
      return;
    }

    this.api.tickExecution(TICK_DT).subscribe({
      next: res => this.store.applySnapshot(res),
      // On error: stop ticking silently (connection issue, etc.)
      error: () => this.stopTickLoop(),
    });
  }
}
