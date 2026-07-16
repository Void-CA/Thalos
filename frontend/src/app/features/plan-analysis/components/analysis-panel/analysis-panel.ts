import { Component, computed, inject } from '@angular/core';
import { PlanAnalysisStore } from '../../store/plan-analysis.store';
import { SceneStore } from '../../../scene/store/scene.store';

@Component({
  selector: 'analysis-panel',
  standalone: true,
  imports: [],
  styleUrl: './analysis-panel.scss',
  template: `
    <div class="analysis-panel">
      <!-- ── ACTION ── -->
      <section class="analysis-panel__action">
        <button
          class="action action--analyze"
          (click)="onAnalyze()"
          [disabled]="store.loading() || disabledReason() !== null"
          [title]="disabledReason() ?? ''"
        >
          {{ store.loading() ? 'Analyzing\u2026' : 'Analyze Plan' }}
        </button>
      </section>

      <!-- ── SUMMARY ── -->
      @if (store.summary(); as summary) {
        <section class="analysis-panel__summary">
          <div class="summary__score" [class]="'score--' + summary.status">
            <span class="score__value">{{ summary.score }}</span>
            <span class="score__grade">{{ summary.grade }}</span>
          </div>
          <div class="summary__info">
            <p class="summary__message">{{ summary.message }}</p>
            <div class="summary__metrics">
              @if (store.metrics(); as m) {
                <span class="summary__metric">⏱ {{ m.duration.toFixed(1) }}s</span>
                @if (m.average_manipulability !== null) {
                  <span class="summary__metric">
                    μ {{ m.average_manipulability.toFixed(2) }}
                  </span>
                }
                @if (m.min_collision_distance !== null && m.min_collision_distance > 0) {
                  <span class="summary__metric">
                    ⎔ {{ (m.min_collision_distance * 1000).toFixed(0) }}mm
                  </span>
                }
              }
            </div>
          </div>
        </section>
      }

      <!-- ── FINDINGS ── -->
      @if (store.findings().length > 0) {
        <section class="analysis-panel__findings">
          <h4 class="analysis-panel__label" style="margin:0 0 0.4rem">Findings</h4>
          <ul class="findings__list">
            @for (f of store.findings(); track f) {
              <li
                class="finding"
                [class]="'finding--' + f.severity"
                (click)="onFindingClick(f.waypoint)"
              >
                <span class="finding__icon">{{ iconFor(f.severity) }}</span>
                <span class="finding__message">{{ f.message }}</span>
                @if (f.waypoint !== null) {
                  <span class="finding__waypoint">wp{{ f.waypoint }}</span>
                }
              </li>
            }
          </ul>
        </section>
      }

      <!-- ── RECOMMENDATIONS ── -->
      @if (store.recommendations().length > 0) {
        <section class="analysis-panel__recommendations">
          <h4 class="analysis-panel__label" style="margin:0 0 0.4rem">Recommendations</h4>
          <ul class="recommendations__list">
            @for (r of store.recommendations(); track r) {
              <li class="recommendation">
                <div class="recommendation__header">
                  <span class="recommendation__impact" [class]="'impact--' + r.impact">
                    {{ r.impact }}
                  </span>
                  <span class="recommendation__kind">{{ r.kind.replace('_', ' ') }}</span>
                </div>
                <div class="recommendation__message">{{ r.message }}</div>
              </li>
            }
          </ul>
        </section>
      }

      <!-- ── EMPTY ── -->
      @if (!store.hasResult() && !store.loading() && !store.error()) {
        <section class="analysis-panel__empty">
          No analysis yet. Create a plan and press "Analyze Plan".
        </section>
      }

      <!-- ── ERROR ── -->
      @if (store.error(); as err) {
        <div class="error-msg">{{ err }}</div>
      }
    </div>
  `,
})
export class AnalysisPanel {
  readonly store = inject(PlanAnalysisStore);
  private readonly sceneStore = inject(SceneStore);

  /** Reason why buttons are disabled, or null if they should be enabled. */
  protected readonly disabledReason = computed<string | null>(() => {
    const plan = this.sceneStore.state().activePlan;
    if (plan) return null;
    return 'No active plan';
  });

  onAnalyze(): void {
    this.store.analyzePlan();
  }

  /** When a finding waypoint is clicked, navigate the scene to it. */
  onFindingClick(waypoint: number | null): void {
    if (waypoint === null) return;
    // TODO: Highlight waypoint in the Three.js viewer
    // For now, the click selects the finding
  }

  iconFor(severity: string): string {
    switch (severity) {
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
      default: return '•';
    }
  }
}
