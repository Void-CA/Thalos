import { Component, inject, signal } from '@angular/core';
import { PlanAnalysisApiService } from '../services/plan-analysis-api.service';
import type { AlternativesResponse, RankedAlternativeDto } from '../plan-analysis-api.types';

/**
 * Panel de alternativas — muestra el plan original vs candidatos rankeados.
 *
 * Aparece como tool en modo Planning después de analizar el plan.
 */
@Component({
  selector: 'alternatives-panel',
  standalone: true,
  template: `
    <div class="alternatives-panel">
      <div class="ap__header">
        <button class="ap__btn ap__btn--primary" (click)="generate()" [disabled]="loading()">
          {{ loading() ? 'Generating…' : 'Generate Alternatives' }}
        </button>
      </div>

      @if (error()) {
        <p class="ap__error">{{ error() }}</p>
      }

      @if (data(); as d) {
        @if (d.alternatives.length === 0) {
          <p class="ap__empty">No alternatives found. The plan may have no problematic waypoints.</p>
        } @else {
          <!-- Original score -->
          <div class="ap__original">
            <span class="ap__label">Original Score</span>
            <span class="ap__score ap__score--original">{{ d.original_score.toFixed(1) }}</span>
            <div class="ap__bar">
              <div class="ap__bar-fill ap__bar-fill--original" [style.width.%]="scorePct(d.original_score)"></div>
            </div>
          </div>

          <!-- Alternatives list -->
          <div class="ap__list">
            @for (alt of d.alternatives; track alt.rank) {
              <div class="ap__card" [class.ap__card--best]="alt.rank === 1">
                <div class="ap__card-header">
                  <span class="ap__rank">#{{ alt.rank }}</span>
                  <span class="ap__score ap__score--alt">{{ alt.score.toFixed(1) }}</span>
                  <span class="ap__delta" [class.ap__delta--pos]="alt.delta_score > 0">
                    {{ alt.delta_score > 0 ? '▼' : '▲' }} {{ alt.improvement_percent.toFixed(1) }}%
                  </span>
                </div>

                <div class="ap__card-body">
                  <div class="ap__bar ap__bar--alt">
                    <div class="ap__bar-fill ap__bar-fill--alt" [style.width.%]="scorePct(alt.score)"></div>
                  </div>

                  <div class="ap__meta">
                    <span class="ap__meta-item">Waypoint {{ alt.source_waypoint }}</span>
                    @for (p of alt.perturbations; track p.joint) {
                      <span class="ap__meta-item">Joint {{ p.joint }} {{ p.delta > 0 ? '+' : '' }}{{ p.delta.toFixed(3) }}</span>
                    }
                  </div>

                  @if (alt.improvements.length > 0) {
                    <div class="ap__improvements">
                      @for (imp of alt.improvements; track $index) {
                        <span class="ap__improvement" [class.ap__improvement--pos]="!imp.includes('worse')">
                          {{ imp }}
                        </span>
                      }
                    </div>
                  }

                  <details class="ap__breakdown">
                    <summary class="ap__breakdown-summary">Metric breakdown</summary>
                    <div class="ap__breakdown-body">
                      @for (b of alt.breakdown; track b.name) {
                        <div class="ap__breakdown-row">
                          <span class="ap__breakdown-name">{{ b.name }}</span>
                          <span class="ap__breakdown-val">
                            {{ b.original.toFixed(3) }} → {{ b.candidate.toFixed(3) }}
                          </span>
                        </div>
                      }
                    </div>
                  </details>
                </div>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .alternatives-panel {
      font-family: monospace;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .ap__header {
      display: flex;
      gap: 0.4rem;
    }

    .ap__btn {
      font-family: monospace;
      font-size: 0.72rem;
      padding: 0.3rem 0.6rem;
      border-radius: 3px;
      border: 1px solid #555;
      background: #222;
      color: #ddd;
      cursor: pointer;
      transition: background 0.15s;

      &:hover:not(:disabled) { background: #333; }
      &:disabled { opacity: 0.4; cursor: default; }

      &--primary {
        border-color: #3399ff;
        color: #3399ff;
        &:hover:not(:disabled) { background: #1a2a3a; }
      }
    }

    .ap__error {
      color: #cc4444;
      font-size: 0.7rem;
    }

    .ap__empty {
      text-align: center;
      font-size: 0.72rem;
      opacity: 0.5;
    }

    .ap__original {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.72rem;
    }

    .ap__label {
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.65rem;
    }

    .ap__score {
      font-weight: 700;
      font-size: 0.8rem;
      min-width: 3ch;
      &--original { color: #33ccff; }
      &--alt { color: #44cc44; }
    }

    .ap__delta {
      font-size: 0.65rem;
      &--pos { color: #44cc44; }
    }

    .ap__bar {
      flex: 1;
      height: 5px;
      background: #333;
      border-radius: 2px;
      overflow: hidden;
    }

    .ap__bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
      &--original { background: #33ccff; }
      &--alt { background: #44cc44; }
    }

    .ap__list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .ap__card {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: 0.4rem;
      border-radius: 4px;
      background: #2a2a2a;
      border: 1px solid #444;

      &--best {
        border-color: #44cc44;
      }
    }

    .ap__card-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .ap__rank {
      font-weight: 700;
      color: #44cc44;
      font-size: 0.75rem;
    }

    .ap__card-body {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .ap__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      font-size: 0.65rem;
    }

    .ap__meta-item {
      background: #333;
      padding: 0.1rem 0.3rem;
      border-radius: 2px;
      color: #aaa;
    }

    .ap__improvements {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .ap__improvement {
      font-size: 0.65rem;
      padding: 0.1rem 0.3rem;
      border-radius: 2px;
      &--pos { color: #44cc44; background: #1a3a1a; }
    }

    .ap__bar--alt {
      height: 4px;
    }

    .ap__breakdown {
      font-size: 0.65rem;
    }

    .ap__breakdown-summary {
      cursor: pointer;
      opacity: 0.6;
      &:hover { opacity: 1; }
    }

    .ap__breakdown-body {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      padding: 0.2rem 0 0 0.5rem;
    }

    .ap__breakdown-row {
      display: flex;
      justify-content: space-between;
    }

    .ap__breakdown-name {
      opacity: 0.5;
    }

    .ap__breakdown-val {
      font-weight: 600;
    }
  `,
})
export class AlternativesPanel {
  private readonly api = inject(PlanAnalysisApiService);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly data = signal<AlternativesResponse | null>(null);

  protected generate(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.generateAlternatives().subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.message ?? 'Failed to generate alternatives');
        this.loading.set(false);
      },
    });
  }

  /** Scale score to percentage bar width. Lower = better, so we invert. */
  protected scorePct(score: number): number {
    // 100 = max reasonable score, clamp to [0, 100]
    return Math.max(0, Math.min(100, (1 - score / 100) * 100));
  }
}
