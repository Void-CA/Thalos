import { Component, inject } from '@angular/core';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import type { RankedAlternativeDto } from '../plan-analysis-api.types';

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
        <button class="ap__btn ap__btn--primary" (click)="generate()" [disabled]="store.alternativesLoading()">
          {{ store.alternativesLoading() ? 'Generating…' : 'Generate Alternatives' }}
        </button>
      </div>

      @if (store.alternativesError(); as err) {
        <p class="ap__error">{{ err }}</p>
      }

      @if (store.alternativesData(); as d) {
        @if (d.alternatives.length === 0) {
          <p class="ap__empty">No alternatives found. The plan may have no problematic waypoints.</p>
        } @else {
          <!-- Original score -->
          <div class="ap__original">
            <span class="ap__label">Original Score</span>
            <span class="ap__score ap__score--original">{{ d.original_score.toFixed(4) }}</span>
            <div class="ap__bar">
              <div class="ap__bar-fill ap__bar-fill--original" [style.width.%]="scorePct(d.original_score)"></div>
            </div>
          </div>

          <!-- Alternatives list -->
          <div class="ap__list">
            @for (alt of d.alternatives; track alt.rank) {
              <div
                class="ap__card"
                [class.ap__card--best]="alt.rank === 1"
                [class.ap__card--selected]="store.selectedAlternativeRank() === alt.rank"
                (click)="selectAlternative(alt.rank)"
              >
                <div class="ap__card-header">
                  <span class="ap__rank">#{{ alt.rank }}</span>
                  <span class="ap__score ap__score--alt">{{ alt.score.toFixed(4) }}</span>
                  <span class="ap__delta" [class.ap__delta--pos]="alt.delta_score > 0">
                    {{ alt.delta_score > 0 ? '▼' : '▲' }} {{ alt.improvement_percent.toFixed(2) }}%
                  </span>
                  <span class="ap__vs">vs {{ alt.original_score.toFixed(4) }} original</span>
                </div>

                <div class="ap__card-body">
                  <div class="ap__meta">
                    @let wpRange = perturbationRange(alt.perturbations);
                    <span class="ap__meta-item">Waypoints {{ wpRange.min }}{{ wpRange.max > wpRange.min ? '–' + wpRange.max : '' }}</span>
                    @for (g of groupPerturbations(alt.perturbations); track $index) {
                      <span class="ap__meta-item">J{{ g.joint }} {{ g.delta > 0 ? '+' : '' }}{{ g.delta.toFixed(3) }}{{ g.count > 1 ? ' \u00d7 ' + g.count : '' }}</span>
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
                    <summary class="ap__breakdown-summary">Score breakdown</summary>
                    <div class="ap__breakdown-body">
                      @for (b of alt.breakdown; track b.name) {
                        <div class="ap__breakdown-row">
                          <span class="ap__breakdown-name">{{ b.name }}</span>
                          <span class="ap__breakdown-val">
                            {{ b.original.toFixed(4) }} → {{ b.candidate.toFixed(4) }}
                          </span>
                        </div>
                      }
                    </div>
                  </details>

                  <div class="ap__actions">
                    <button class="ap__btn ap__btn--preview" [class.ap__btn--active]="store.selectedAlternativeRank() === alt.rank" (click)="onPreview(alt); $event.stopPropagation()">
                      {{ store.selectedAlternativeRank() === alt.rank ? 'Previewed' : 'Preview' }}
                    </button>
                    <button class="ap__btn ap__btn--apply" (click)="onApply(alt); $event.stopPropagation()">
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      }
    </div>
  `,
  styleUrl: './alternatives-panel.scss',
})
export class AlternativesPanel {
  protected readonly store = inject(PlanAnalysisStore);
  private readonly focus = inject(FocusService);

  /** Calcula el rango de waypoints afectados. */
  protected perturbationRange(perturbations: { waypoint: number }[]): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const p of perturbations) {
      if (p.waypoint < min) min = p.waypoint;
      if (p.waypoint > max) max = p.waypoint;
    }
    return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
  }

  /** Agrupa perturbaciones consecutivas con el mismo joint+delta para mostrar "J2 -0.050 × 103". */
  protected groupPerturbations(perturbations: { joint: number; delta: number }[]): { joint: number; delta: number; count: number }[] {
    // Agrupar por (joint, delta) usando un Map con clave "joint::delta"
    const map = new Map<string, { joint: number; delta: number; count: number }>();
    for (const p of perturbations) {
      const key = `${p.joint}::${p.delta}`;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { joint: p.joint, delta: p.delta, count: 1 });
      }
    }
    return Array.from(map.values());
  }

  protected generate(): void {
    this.store.generateAlternatives();
  }

  protected generateFromSession(sessionId: number): void {
    this.store.generateAlternatives(sessionId);
  }

  protected selectAlternative(rank: number): void {
    const current = this.store.selectedAlternativeRank();
    this.store.selectedAlternativeRank.set(current === rank ? null : rank);
  }

  /** Preview an alternative — navigate to the affected waypoint. */
  protected onPreview(alt: RankedAlternativeDto): void {
    this.store.selectedAlternativeRank.set(alt.rank);
    if (alt.source_waypoint > 0) {
      this.focus.focusWaypoint(alt.source_waypoint, `Alternative #${alt.rank}`);
    }
  }

  /** Apply an alternative — replace active plan with this candidate. */
  protected onApply(alt: RankedAlternativeDto): void {
    this.store.selectedAlternativeRank.set(alt.rank);
  }

  /** Scale score to percentage bar width. Lower = better, so we invert. */
  protected scorePct(score: number): number {
    return Math.max(0, Math.min(100, (1 - score / 100) * 100));
  }
}
