import { Component, signal, OnDestroy } from '@angular/core';
import type {
  AiObservabilityState,
} from '../../types/ai-observability.types';
import { generateMockData } from './ai-observability.mock';

// ── Component ──

@Component({
  selector: 'ai-observability-panel',
  standalone: true,
  template: `
    <footer class="ai-obs-panel">
      <details class="ai-obs-panel__section" open>
        <summary class="ai-obs-panel__header">AI Observability</summary>

        <div class="ai-obs-panel__grid">
          <!-- Failure Probabilities -->
          <div class="ai-obs-panel__card">
            <h4>Failure Probability</h4>
            @for (fp of state().failureProbabilities; track fp.componentId) {
              <div class="ai-obs-panel__bar-row">
                <span class="ai-obs-panel__label">{{ fp.componentName }}</span>
                <div class="ai-obs-panel__bar">
                  <div
                    class="ai-obs-panel__bar-fill"
                    [class.ai-obs-panel__bar-fill--high]="fp.probability > 0.5"
                    [class.ai-obs-panel__bar-fill--mid]="fp.probability > 0.25 && fp.probability <= 0.5"
                    [class.ai-obs-panel__bar-fill--low]="fp.probability <= 0.25"
                    [style.width.%]="fp.probability * 100"
                  ></div>
                </div>
                <span class="ai-obs-panel__value">{{ fp.probability.toFixed(2) }}</span>
                <span class="ai-obs-panel__trend" [class]="'trend--' + fp.trend">
                  {{ fp.trend === 'increasing' ? '↑' : fp.trend === 'decreasing' ? '↓' : '→' }}
                </span>
              </div>
            }
          </div>

          <!-- Bayesian Confidence -->
          <div class="ai-obs-panel__card">
            <h4>
              Bayesian Confidence
              <span class="ai-obs-panel__overall">({{ state().bayesianConfidence.overall.toFixed(2) }})</span>
            </h4>
            @for (pc of state().bayesianConfidence.perComponent; track pc.componentId) {
              <div class="ai-obs-panel__bar-row">
                <span class="ai-obs-panel__label">{{ pc.componentId }}</span>
                <div class="ai-obs-panel__bar">
                  <div
                    class="ai-obs-panel__bar-fill ai-obs-panel__bar-fill--confidence"
                    [style.width.%]="pc.confidence * 100"
                  ></div>
                </div>
                <span class="ai-obs-panel__value">{{ pc.confidence.toFixed(2) }}</span>
              </div>
            }
          </div>
        </div>
      </details>

      <!-- Symbolic Rule Explanations -->
      <details class="ai-obs-panel__section" open>
        <summary class="ai-obs-panel__header">Symbolic Rule Explanations</summary>
        @for (rule of state().activeRules; track rule.ruleId) {
          <div class="ai-obs-panel__rule" [class.ai-obs-panel__rule--inactive]="!rule.active">
            <span class="ai-obs-panel__rule-icon">{{ rule.active ? '✓' : '✗' }}</span>
            <span class="ai-obs-panel__rule-text">{{ rule.ruleName }}: {{ rule.explanation }}</span>
            <span class="ai-obs-panel__rule-timing">{{ relativeTime(rule.firedAt) }}</span>
          </div>
        }
      </details>

      <!-- Decision History -->
      <details class="ai-obs-panel__section" open>
        <summary class="ai-obs-panel__header">Decision History (last {{ state().decisionHistory.length }})</summary>
        <table class="ai-obs-panel__table">
          <thead>
            <tr>
              <th>Joint</th>
              <th>Meas</th>
              <th>Est</th>
              <th>Δ</th>
              <th>Conf</th>
            </tr>
          </thead>
          <tbody>
            @for (dec of state().decisionHistory; track $index; let i = $index) {
              <tr>
                <td>{{ dec.joint > 0 ? 'J' + dec.joint : '—' }}</td>
                <td>{{ dec.measurement.toFixed(3) }}</td>
                <td>{{ dec.estimation.toFixed(3) }}</td>
                <td>{{ dec.delta.toFixed(4) }}</td>
                <td>{{ (dec.confidence * 100).toFixed(0) }}%</td>
              </tr>
            }
          </tbody>
        </table>
      </details>
    </footer>
  `,
  styleUrl: './ai-observability-panel.scss',
})
export class AiObservabilityPanel implements OnDestroy {
  protected readonly state = signal<AiObservabilityState>(generateMockData());
  private readonly intervalId: ReturnType<typeof setInterval>;

  constructor() {
    this.intervalId = setInterval(() => {
      this.state.set(generateMockData());
    }, 2500);
  }

  ngOnDestroy(): void {
    clearInterval(this.intervalId);
  }

  protected relativeTime(iso: string): string {
    const elapsed = Date.now() - new Date(iso).getTime();
    if (elapsed < 1000) return 'now';
    if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s ago`;
    return `${Math.floor(elapsed / 60_000)}m ago`;
  }
}
