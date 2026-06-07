import { Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RobotStore } from '../../../robots/store/robot.store';
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
          [disabled]="store.loading() || !robotId()"
        >
          {{ store.loading() ? 'Sampling\u2026' : 'Sample Workspace' }}
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

      <!-- ── RESULTS ── -->
      @if (store.data(); as data) {
        <section class="workspace-panel__outputs">
          <h4 class="workspace-panel__label">Metrics</h4>
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

  /** Currently selected robot ID from the global catalog. */
  protected readonly robotId = this.robotStore.selectedId;

  samples = 5_000;
  seed = 0;
  tolerance = 0.001;

  constructor() {
    // Reset workspace data when the user switches robots
    effect(() => {
      this.robotStore.selectedId();
      this.store.reset();
    });
  }

  onSample(): void {
    const id = this.robotId();
    if (!id) return;
    this.store.sample(id, this.samples, this.seed, this.tolerance);
  }
}
