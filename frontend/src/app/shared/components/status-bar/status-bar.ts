import { Component, computed, inject } from '@angular/core';
import { SceneStore } from '../../../features/scene/store/scene.store';

/**
 * Pulse line at the very bottom — always visible, never collapsible.
 *
 * Shows the four things a user needs at a glance:
 *   Backend · Robot · Execution · Error · Timestamp
 */
@Component({
  selector: 'status-bar',
  standalone: true,
  template: `
    <footer class="status-bar">
      <div class="status-bar__group">
        <!-- Backend / Connection -->
        <span class="status-bar__item status-bar__item--backend">Sim</span>
        <span class="status-bar__sep">·</span>

        <!-- Robot identity -->
        @let robot = robotInfo();
        <span class="status-bar__item">{{ robot }}</span>
        <span class="status-bar__sep">·</span>

        <!-- Execution status -->
        <span
          class="status-bar__item status-bar__item--exec"
          [class.status-bar__item--running]="execState() === 'Active'"
          [class.status-bar__item--paused]="execState() === 'Paused'"
          [class.status-bar__item--failed]="execState() === 'Failed' || execState() === 'Cancelled'"
          [class.status-bar__item--done]="execState() === 'Completed'"
        >
          {{ execLabel() }}
        </span>

        @if (hasError()) {
          <span class="status-bar__sep">·</span>
          <span class="status-bar__item status-bar__item--error" title="Click to open Log tab">
            ⚠ {{ errorCount() }}
          </span>
        }
      </div>

      <div class="status-bar__spacer"></div>

      <div class="status-bar__group">
        <span class="status-bar__item status-bar__item--time">{{ timestamp() }}</span>
      </div>
    </footer>
  `,
  styles: `
    :host {
      display: block;
      flex-shrink: 0;
    }

    .status-bar {
      display: flex;
      align-items: center;
      height: 22px;
      padding: 0 0.75rem;
      background: #181818;
      border-top: 1px solid #333;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.65rem;
      gap: 0.35rem;
      user-select: none;

      &__group {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }

      &__spacer {
        flex: 1;
      }

      &__item {
        color: #999;
        white-space: nowrap;

        &--backend {
          color: #44cc44;
          font-weight: 700;
        }

        &--exec {
          font-weight: 600;

          &.status-bar__item--running {
            color: #33ccff;
          }
          &.status-bar__item--paused {
            color: #ffaa33;
          }
          &.status-bar__item--failed {
            color: #cc4444;
          }
          &.status-bar__item--done {
            color: #44cc44;
          }
        }

        &--error {
          color: #cc4444;
          font-weight: 700;
          cursor: pointer;
        }

        &--time {
          opacity: 0.5;
        }
      }

      &__sep {
        color: #444;
      }
    }
  `,
})
export class StatusBar {
  private readonly scene = inject(SceneStore);

  protected readonly robotInfo = computed(() => {
    const rt = this.scene.state()?.runtime;
    if (!rt?.robot) return 'No robot';
    return `${rt.robot.display_name} · ${rt.robot.dof}DOF`;
  });

  /** Effective execution state — merges PlanState + SessionStatus. */
  protected readonly execState = computed(() => {
    const state = this.scene.state();
    const exe = state?.execution;
    const plan = state?.activePlan;
    return (exe?.status ?? plan?.state) || '—';
  });

  protected readonly execLabel = computed(() => {
    const st = this.execState();
    const exe = this.scene.state()?.execution;
    if (st === 'Active' && exe?.progress != null) {
      return `Running ${Math.round(exe.progress * 100)}%`;
    }
    return st;
  });

  protected readonly hasError = computed(() => {
    return !!this.scene.state()?.ui?.error;
  });

  protected readonly errorCount = computed(() => {
    return this.scene.state()?.ui?.error ? 1 : 0;
  });

  protected readonly timestamp = computed(() => {
    const rt = this.scene.state()?.runtime;
    if (!rt?.generatedAt) return '';
    try {
      const d = new Date(rt.generatedAt);
      return d.toLocaleTimeString();
    } catch {
      return '';
    }
  });
}
