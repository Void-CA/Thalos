import { Component, computed, inject } from '@angular/core';
import { SceneStore } from '../../../features/scene/store/scene.store';

/**
 * Pulse line at the very bottom — always visible, never collapsible.
 */
@Component({
  selector: 'status-bar',
  standalone: true,
  styleUrl: './status-bar.scss',
  template: `
    <footer class="status-bar">
      <div class="status-bar__group">
        <span class="status-bar__item status-bar__item--backend">Sim</span>
        <span class="status-bar__sep">·</span>

        @let robot = robotInfo();
        <span class="status-bar__item">{{ robot }}</span>
        <span class="status-bar__sep">·</span>

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
          <span class="status-bar__item status-bar__item--error">
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
})
export class StatusBar {
  private readonly scene = inject(SceneStore);

  protected readonly robotInfo = computed(() => {
    const rt = this.scene.state()?.runtime;
    if (!rt?.robot) return 'No robot';
    return `${rt.robot.display_name} · ${rt.robot.dof}DOF`;
  });

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
