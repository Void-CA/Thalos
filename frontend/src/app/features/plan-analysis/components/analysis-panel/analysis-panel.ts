import { Component, computed, inject } from '@angular/core';
import { PlanAnalysisStore } from '../../store/plan-analysis.store';
import { SceneStore } from '../../../scene/store/scene.store';
import { FocusService } from '../../../../shared/services/focus.service';
import { ActionDispatcher } from '../../../../shared/services/action-dispatcher.service';
import { suggestionKindToAction } from '../../../../shared/types/recommendation-action';

@Component({
  selector: 'analysis-panel',
  standalone: true,
  imports: [],
  styleUrl: './analysis-panel.scss',
  template: `
    <div class="analysis-panel">
      <!-- ── PLAN STATUS ── -->
      @if (activePlanInfo(); as info) {
        <section class="analysis-panel__plan-info">
          <span class="plan-info__badge" [class]="'plan-info__badge--' + info.stateClass">
            {{ info.stateLabel }}
          </span>
          <span class="plan-info__text">
            {{ info.segments }} segment{{ info.segments !== 1 ? 's' : '' }}
            &middot; {{ info.waypoints }} waypoints
          </span>
        </section>
      }

      <!-- ── ACTION ── -->
      <section class="analysis-panel__action">
        <button
          class="action action--analyze"
          (click)="onAnalyze()"
          [disabled]="store.loading() || disabledReason() !== null"
          [title]="disabledReason() ?? ''"
        >
          @if (store.loading()) {
            Analyzing&hellip;
          } @else if (store.hasResult()) {
            Re-analyze
          } @else {
            Analyze Plan
          }
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
                @if (m.average_manipulability != null) {
                  <span class="summary__metric">
                    &mu; {{ m.average_manipulability.toFixed(2) }}
                  </span>
                }
                @if (m.min_collision_distance != null && m.min_collision_distance > 0) {
                  <span class="summary__metric">
                    &#x2399; {{ (m.min_collision_distance * 1000).toFixed(0) }}mm
                  </span>
                }
                @if (m.singular_count > 0) {
                  <span class="summary__metric summary__metric--warn">
                    &#x26D4; {{ m.singular_count }} singular
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
          <h4 class="analysis-panel__label" style="margin:0 0 0.4rem">
            Findings ({{ store.findings().length }})
          </h4>
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
          <h4 class="analysis-panel__label" style="margin:0 0 0.4rem">
            Recommendations ({{ store.recommendations().length }})
          </h4>
          <ul class="recommendations__list">
            @for (r of store.recommendations(); track r) {
              <li class="recommendation">
                <div class="recommendation__header">
                  <span class="recommendation__impact" [class]="'impact--' + r.impact">
                    {{ r.impact }}
                  </span>
                  <span class="recommendation__kind">{{ r.kind.replace('_', ' ') }}</span>
                  <button
                    class="recommendation__apply"
                    (click)="onApplyRecommendation(r)"
                    title="Apply"
                  >Apply</button>
                </div>
                <div class="recommendation__message">{{ r.message }}</div>
              </li>
            }
          </ul>
        </section>
      }

      <!-- ── EMPTY STATE ── -->
      @if (!store.hasResult() && !store.loading() && !store.error()) {
        @if (activePlanInfo()) {
          <section class="analysis-panel__ready">
            Plan ready. Press <strong>Analyze Plan</strong> to check for issues.
          </section>
        } @else {
          <section class="analysis-panel__empty">
            <p>No plan to analyze.</p>
            <p class="analysis-panel__hint">
              Switch to <strong>Planning</strong> mode, create a motion program,
              and press <strong>Preview</strong> first.
            </p>
          </section>
        }
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
  private readonly focus = inject(FocusService);
  private readonly actions = inject(ActionDispatcher);

  /** Info about the active plan, or null if none. */
  protected readonly activePlanInfo = computed<{
    stateLabel: string;
    stateClass: string;
    segments: number;
    waypoints: number;
  } | null>(() => {
    const plan = this.sceneStore.state().activePlan;
    if (!plan) return null;

    const stateLabel = plan.state;
    const stateClass = plan.state === 'Created' ? 'created'
      : plan.state === 'Active' ? 'active'
      : plan.state === 'Paused' ? 'paused'
      : plan.state === 'Completed' || plan.state === 'Failed' ? 'terminal'
      : 'default';

    const segments = plan.segments?.length ?? 1;
    const waypoints = plan.visualization?.waypoints.length ?? 0;
    return { stateLabel, stateClass, segments, waypoints };
  });

  /** Reason why buttons are disabled, or null if they should be enabled. */
  protected readonly disabledReason = computed<string | null>(() => {
    const plan = this.sceneStore.state().activePlan;
    if (!plan) return 'Create a plan in Planning mode first';
    if (plan.state === 'Failed') return 'Plan failed';
    return null;
  });

  onAnalyze(): void {
    this.store.analyzePlan();
  }

  onFindingClick(waypoint: number | null): void {
    if (waypoint !== null) {
      this.focus.focusWaypoint(waypoint);
    }
  }

  onApplyRecommendation(r: { kind: string; waypoint: number | null }): void {
    const action = suggestionKindToAction(r.kind, r.waypoint);
    this.actions.dispatch(action);
  }

  iconFor(severity: string): string {
    switch (severity) {
      case 'error': return '\u2715';
      case 'warning': return '\u26A0';
      case 'info': return '\u2139';
      default: return '\u2022';
    }
  }
}
