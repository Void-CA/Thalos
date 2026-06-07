import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RobotApiService } from '../../../robots/services/robot-api.service';
import { WorkspaceStore } from '../../store/workspace.store';

@Component({
  selector: 'workspace-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="workspace-panel">
      <h3 class="panel-title">Workspace Analysis</h3>

      <!-- Sampling form -->
      <div class="form-group">
        <label>
          Robot
          <select [(ngModel)]="selectedRobot" (change)="onRobotChange()">
            <option value="" disabled>Select robot</option>
            @for (robot of robots(); track robot.id) {
              <option [value]="robot.id">{{ robot.display_name }}</option>
            }
          </select>
        </label>
      </div>

      <div class="form-row">
        <label>
          Samples
          <input type="number" [(ngModel)]="samples" min="100" max="100000" step="100" />
        </label>
        <label>
          Seed
          <input type="number" [(ngModel)]="seed" />
        </label>
      </div>

      <div class="form-row">
        <label>
          Tolerance
          <input type="number" [(ngModel)]="tolerance" step="0.001" min="0.001" />
        </label>
      </div>

      <button
        class="btn-sample"
        (click)="onSample()"
        [disabled]="store.loading() || !selectedRobot"
      >
        {{ store.loading() ? 'Sampling…' : 'Sample Workspace' }}
      </button>

      <!-- Metrics display -->
      @if (store.data(); as data) {
        <div class="metrics-card">
          <h4>Metrics</h4>
          <table>
            <tr><td>Samples</td><td>{{ data.metrics.sampleCount }}</td></tr>
            <tr><td>Max Reach</td><td>{{ data.metrics.maxReach.toFixed(4) }} m</td></tr>
            <tr><td>Min Reach</td><td>{{ data.metrics.minReach.toFixed(4) }} m</td></tr>
            <tr><td>Bounding Volume</td><td>{{ data.metrics.boundingVolume.toFixed(4) }} m³</td></tr>
            <tr>
              <td>Centroid</td>
              <td>({{ data.metrics.centroid[0].toFixed(3) }},
                  {{ data.metrics.centroid[1].toFixed(3) }},
                  {{ data.metrics.centroid[2].toFixed(3) }})</td>
            </tr>
          </table>
        </div>
      }

      <!-- Reachability query -->
      @if (store.hasData()) {
        <hr class="divider" />
        <h4>Check Reachability</h4>

        <div class="form-row triple">
          <label>X <input type="number" [(ngModel)]="queryPoint[0]" step="0.1" /></label>
          <label>Y <input type="number" [(ngModel)]="queryPoint[1]" step="0.1" /></label>
          <label>Z <input type="number" [(ngModel)]="queryPoint[2]" step="0.1" /></label>
        </div>

        <button
          class="btn-query"
          (click)="onCheck()"
          [disabled]="store.loading()"
        >
          {{ store.loading() ? 'Checking…' : 'Check Reachability' }}
        </button>

        @if (store.reachability(); as r) {
          <div class="reachability-result" [class.reachable]="r.reachable" [class.unreachable]="!r.reachable">
            <strong>{{ r.reachable ? '✓ Reachable' : '✗ Out of Workspace' }}</strong>
            @if (!r.reachable) {
              <span> — nearest distance: {{ r.nearestDistance.toFixed(4) }} m</span>
            }
          </div>
        }
      }

      <!-- Error display -->
      @if (store.error(); as err) {
        <div class="error-msg">{{ err }}</div>
      }
    </div>
  `,
  styles: [`
    .workspace-panel { padding: 0.5rem; font-size: 0.85rem; }
    .panel-title { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; }
    .form-group { margin-bottom: 0.5rem; }
    .form-group label { display: flex; flex-direction: column; gap: 0.25rem; }
    .form-group select { width: 100%; }
    .form-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
    .form-row label { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; }
    .form-row.triple label { flex: 1; }
    .form-row input, .form-group select {
      padding: 0.3rem; border: 1px solid #555; border-radius: 4px;
      background: #2a2a2a; color: #ddd; font-size: 0.8rem;
    }
    .btn-sample, .btn-query {
      width: 100%; padding: 0.5rem; margin-top: 0.4rem;
      border: none; border-radius: 4px; cursor: pointer; font-weight: 600;
    }
    .btn-sample { background: #4a90d9; color: #fff; }
    .btn-sample:disabled { background: #444; color: #888; cursor: not-allowed; }
    .btn-query { background: #7b61ff; color: #fff; }
    .btn-query:disabled { background: #444; color: #888; cursor: not-allowed; }
    .metrics-card {
      margin-top: 0.75rem; padding: 0.5rem; background: #2a2a2a;
      border-radius: 4px; border: 1px solid #444;
    }
    .metrics-card h4 { margin: 0 0 0.4rem; }
    .metrics-card table { width: 100%; border-collapse: collapse; }
    .metrics-card td { padding: 0.2rem 0.4rem; border-bottom: 1px solid #333; }
    .metrics-card td:first-child { color: #999; }
    .metrics-card td:last-child { text-align: right; font-family: monospace; }
    .divider { border: none; border-top: 1px solid #444; margin: 0.75rem 0; }
    .reachability-result {
      margin-top: 0.5rem; padding: 0.4rem; border-radius: 4px;
      text-align: center; font-size: 0.9rem;
    }
    .reachable { background: #1a3a1a; color: #5f5; border: 1px solid #2a5a2a; }
    .unreachable { background: #3a1a1a; color: #f55; border: 1px solid #5a2a2a; }
    .error-msg { margin-top: 0.5rem; padding: 0.4rem; background: #3a1a1a; color: #f88; border-radius: 4px; font-size: 0.8rem; }
    h4 { margin: 0.5rem 0 0.3rem; }
  `],
})
export class WorkspacePanel {
  private readonly robotApi = inject(RobotApiService);
  readonly store = inject(WorkspaceStore);

  private readonly robotsObs = this.robotApi.getRobots();
  readonly robots = toSignal(this.robotsObs, { initialValue: [] });

  selectedRobot = '';
  samples = 5_000;
  seed = 0;
  tolerance = 0.001;
  queryPoint: [number, number, number] = [0.0, 0.0, 0.0];

  onRobotChange(): void {
    this.store.reset();
  }

  onSample(): void {
    this.store.sample(this.selectedRobot, this.samples, this.seed, this.tolerance);
  }

  onCheck(): void {
    this.store.checkReachability(this.queryPoint, this.tolerance);
  }
}
