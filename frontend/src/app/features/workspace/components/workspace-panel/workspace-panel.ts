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

      <!-- ── WORKSPACE METRICS ── -->
      @if (store.data(); as data) {
        <section class="workspace-panel__outputs">
          <h4 class="workspace-panel__label">Workspace Metrics</h4>
          <table class="metrics-table">
            <tr><td>Samples</td><td>{{ data.metrics.sampleCount }}</td></tr>
            <tr><td>Max Reach</td><td>{{ data.metrics.maxReach.toFixed(4) }} m</td></tr>
            <tr><td>Min Reach</td><td>{{ data.metrics.minReach.toFixed(4) }} m</td></tr>
            <tr><td>Bounding Volume</td><td>{{ data.metrics.boundingVolume.toFixed(4) }} m&sup3;</td></tr>
            <tr>
              <td>Centroid</td>
              <td>({{ data.metrics.centroid[0].toFixed(3) }},
                  {{ data.metrics.centroid[1].toFixed(3) }},
                  {{ data.metrics.centroid[2].toFixed(3) }})</td>
            </tr>
          </table>
        </section>
      }

      <!-- ── SINGULARITY METRICS ── -->
      @if (store.singularity(); as s) {
        <section class="workspace-panel__outputs">
          <h4 class="workspace-panel__label singularity-title">Singularity Metrics</h4>
          <table class="metrics-table">
            <tr><td>Normal</td><td class="state-normal">{{ s.metrics.normalCount }}</td></tr>
            <tr><td>Near Singular</td><td class="state-near">{{ s.metrics.nearSingularCount }}</td></tr>
            <tr><td>Singular</td><td class="state-singular">{{ s.metrics.singularCount }}</td></tr>
            <tr><td>Avg Condition #</td><td>{{ s.metrics.avgConditionNumber.toFixed(2) }}</td></tr>
          </table>
        </section>
      }

      <!-- ── MANIPULABILITY METRICS ── -->
      @if (store.manipulability(); as m) {
        <section class="workspace-panel__outputs">
          <h4 class="workspace-panel__label singularity-title">Manipulability Metrics</h4>
          <table class="metrics-table">
            <tr><td>Samples</td><td>{{ m.metrics.totalSamples }}</td></tr>
            <tr><td>Avg Yoshikawa</td><td>{{ m.metrics.avgYoshikawa.toFixed(4) }}</td></tr>
            <tr><td>Min Yoshikawa</td><td>{{ m.metrics.minYoshikawa.toFixed(4) }}</td></tr>
            <tr><td>Max Yoshikawa</td><td>{{ m.metrics.maxYoshikawa.toFixed(4) }}</td></tr>
            <tr><td>Avg Isotropy</td><td>{{ m.metrics.avgIsotropy.toFixed(4) }}</td></tr>
          </table>
        </section>
      }

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
