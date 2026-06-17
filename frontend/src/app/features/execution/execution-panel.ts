import { Component, computed, inject } from '@angular/core';
import { SceneStore } from '../scene/store/scene.store';

const STATE_COLORS: Record<string, string> = {
  Created: '#ffaa33',
  Active: '#33ccff',
  Completed: '#44cc44',
  Cancelled: '#cc4444',
  Failed: '#cc4444',
};

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
      } @else {
        <p class="empty-state">No active plan</p>
        <p class="empty-state__hint">
          Execute a motion in <strong>Planning</strong> mode to see plan details here.
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
  `,
})
export class ExecutionPanel {
  private readonly store = inject(SceneStore);

  protected readonly planInfo = computed(() => {
    const plan = this.store.state().activePlan;
    if (!plan) return null;

    const stateLabel = plan.state;
    const stateColor = STATE_COLORS[plan.state] ?? '#888';
    const progress = plan.trajectoryProgress ?? 0;

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
    };
  });
}
