import { Component, inject } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AssistantStore } from '../../store/assistant.store';

@Component({
  selector: 'optimize-panel',
  standalone: true,
  imports: [FormsModule, KeyValuePipe],
  template: `
    <div class="optimize-panel">
      @let store = optimizeStore;
      @let objs = store.optimizationObjectives();

      <div class="optimize-panel__card-input">
        <div class="optimize-panel__section-label">Objectives</div>
        <div class="optimize-panel__objectives">
          @for (obj of objs; track obj.id) {
            <label class="optimize-panel__objective" [class.is-disabled]="!obj.enabled">
              <input
                type="checkbox"
                [checked]="obj.enabled"
                (change)="store.toggleObjective(obj.id)"
              />
              <div class="optimize-panel__obj-body">
                <span class="optimize-panel__obj-label">{{ obj.label }}</span>
                <span class="optimize-panel__obj-current">{{ obj.current_value }}{{ obj.unit }} / {{ obj.target_value }}{{ obj.unit }}</span>
                <input
                  class="optimize-panel__weight"
                  type="range" min="0" max="1" step="0.05"
                  [ngModel]="obj.weight"
                  (ngModelChange)="store.updateWeight(obj.id, $event)"
                />
                <span class="optimize-panel__weight-label">w = {{ obj.weight.toFixed(2) }}</span>
              </div>
            </label>
          }
        </div>
      </div>

      <div class="optimize-panel__card-output">
        <div class="optimize-panel__section-label">Pareto Front ({{ store.paretoFront().length }} solutions)</div>
        <div class="optimize-panel__pareto">
          @for (sol of store.paretoFront(); track sol.id) {
            <div class="optimize-panel__solution" [class.solution--rank1]="sol.rank === 1">
              <span class="optimize-panel__sol-id">#{{ sol.id }}</span>
              <div class="optimize-panel__sol-values">
                @for (entry of sol.values | keyvalue; track entry.key) {
                  <span class="optimize-panel__sol-val">
                    {{ entry.key }}: {{ entry.value }}
                  </span>
                }
              </div>
              <span class="optimize-panel__sol-rank">Rank {{ sol.rank }}</span>
            </div>
          }
        </div>
      </div>

      <div class="optimize-panel__meta">
        <span>Iterations: {{ store.optIterations() }}</span>
        <span [class.meta--ok]="store.optConverged()" [class.meta--warn]="!store.optConverged()">
          {{ store.optConverged() ? 'Converged' : 'Not converged' }}
        </span>
      </div>

      <div class="optimize-panel__actions">
        <button class="optimize-panel__run" (click)="run()" [disabled]="store.loading()">
          {{ store.loading() ? 'Optimizing…' : '▶ Run Optimization' }}
        </button>
      </div>

      @if (store.error(); as err) {
        <div class="optimize-panel__error">{{ err }}</div>
      }
    </div>
  `,
  styleUrl: './optimize-panel.scss',
})
export class OptimizePanel {
  protected readonly optimizeStore = inject(AssistantStore);

  protected run(): void {
    this.optimizeStore.runOptimization();
  }
}
