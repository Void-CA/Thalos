import { Component, computed, inject } from '@angular/core';
import { SceneStore } from '../../../features/scene/store/scene.store';

@Component({
  selector: 'bottom-panel',
  standalone: true,
  template: `
    <footer class="bottom-panel">
      <details class="bottom-panel__section" open>
        <summary class="bottom-panel__header">System Snapshot</summary>
        <pre class="bottom-panel__json">{{ snapshotJson() }}</pre>
      </details>
    </footer>
  `,
  styleUrl: './bottom-panel.scss',
})
export class BottomPanel {
  private readonly scene = inject(SceneStore);

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
}
