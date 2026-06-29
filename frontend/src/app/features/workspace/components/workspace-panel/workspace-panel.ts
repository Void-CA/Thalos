import { Component, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RobotStore } from '../../../robots/store/robot.store';
import { SceneStore } from '../../../scene/store/scene.store';
import { WorkspaceStore } from '../../store/workspace.store';

@Component({
  selector: 'workspace-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="workspace-panel">
      <!-- ── INPUTS ── -->
      <section class="workspace-panel__inputs">
        <h4 class="workspace-panel__label">Config</h4>
        <div class="coord-grid">
          <label>Samples
            <input type="number" [(ngModel)]="samples" min="100" max="100000" step="100" />
          </label>
          <label>Seed
            <input type="number" [(ngModel)]="seed" />
          </label>
          <label>Tolerance
            <input type="number" [(ngModel)]="tolerance" step="0.001" min="0.001" />
          </label>
        </div>
      </section>

      <!-- ── ACTIONS ── -->
      <section class="workspace-panel__actions">
        <button
          class="action action--sample"
          (click)="onSample()"
          [disabled]="store.loading() || disabledReason() !== null"
          [title]="disabledReason() ?? ''"
        >
          {{ store.loading() ? 'Sampling\u2026' : 'Sample Workspace' }}
        </button>

        <button
          class="action action--singularity"
          (click)="onAnalyzeSingularity()"
          [disabled]="store.loading() || disabledReason() !== null"
          [title]="disabledReason() ?? ''"
        >
          {{ store.loading() ? 'Analyzing\u2026' : 'Singularity Analysis' }}
        </button>

        <button
          class="action action--manipulability"
          (click)="onAnalyzeManipulability()"
          [disabled]="store.loading() || disabledReason() !== null"
          [title]="disabledReason() ?? ''"
        >
          {{ store.loading() ? 'Analyzing\u2026' : 'Manipulability' }}
        </button>

        <label class="toggle">
          <input
            type="checkbox"
            [checked]="store.showPointCloud()"
            (change)="store.setShowPointCloud($any($event.target).checked)"
          />
          <span class="toggle__label">Show Point Cloud</span>
        </label>
      </section>

      <!-- ── ERROR ── -->
      @if (store.error(); as err) {
        <div class="error-msg">{{ err }}</div>
      }
    </div>
  `,
  styleUrl: './workspace-panel.scss',
})
export class WorkspacePanel {
  readonly store = inject(WorkspaceStore);
  private readonly robotStore = inject(RobotStore);
  private readonly sceneStore = inject(SceneStore);

  /** Currently selected robot ID from the global catalog. */
  protected readonly robotId = this.robotStore.selectedId;

  /** True when the scene has an active robot (URDF or canonical). */
  private readonly hasActiveRobot = computed(() =>
    this.sceneStore.state().runtime !== null,
  );

  /** Reason why buttons are disabled, or null if they should be enabled. */
  protected readonly disabledReason = computed<string | null>(() => {
    if (this.robotId()) return null;       // canonical robot selected
    if (this.hasActiveRobot()) return null; // URDF / default robot active
    return 'No robot loaded';
  });

  samples = 5_000;
  seed = 0;
  tolerance = 0.001;
  nearSingularThreshold = 100;

  constructor() {
    // Reset workspace data when the user switches robots
    effect(() => {
      this.robotStore.selectedId();
      this.store.reset();
    });
  }

  /** Use canonical path when a catalog robot is selected, active path otherwise. */
  onSample(): void {
    const id = this.robotId();
    if (id) {
      this.store.sample(id, this.samples, this.seed, this.tolerance);
    } else {
      this.store.sampleActive(this.samples, this.seed, this.tolerance);
    }
  }

  onAnalyzeSingularity(): void {
    const id = this.robotId();
    if (id) {
      this.store.analyzeSingularity(id, this.samples, this.seed, this.tolerance, this.nearSingularThreshold);
    } else {
      this.store.analyzeActiveSingularity(this.samples, this.seed, this.tolerance, this.nearSingularThreshold);
    }
  }

  onAnalyzeManipulability(): void {
    const id = this.robotId();
    if (id) {
      this.store.analyzeManipulability(id, this.samples, this.seed, this.tolerance);
    } else {
      this.store.analyzeActiveManipulability(this.samples, this.seed, this.tolerance);
    }
  }
}
