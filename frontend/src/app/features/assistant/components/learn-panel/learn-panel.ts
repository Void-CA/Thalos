import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AssistantStore } from '../../store/assistant.store';

@Component({
  selector: 'learn-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="learn-panel">
      @let store = learnStore;
      @if (store.loading()) {
        <p class="learn-panel__loading">Analyzing execution history…</p>
      }

      <div class="learn-panel__card-output">
        <div class="learn-panel__section-label">Execution Insights</div>
        <div class="learn-panel__insights">
          @for (insight of store.executionInsights(); track insight.metric) {
            <div class="learn-panel__insight">
              <div class="learn-panel__insight-header">
                <span class="learn-panel__insight-metric">{{ insight.metric }}</span>
                <span class="learn-panel__trend"
                  [class.trend--up]="insight.trend === 'improving'"
                  [class.trend--flat]="insight.trend === 'stable'"
                  [class.trend--down]="insight.trend === 'degrading'">
                  {{ insight.trend === 'improving' ? '↗' : insight.trend === 'stable' ? '→' : '↘' }}
                </span>
              </div>
              <div class="learn-panel__insight-stats">
                <span>μ {{ insight.average }}</span>
                <span>min {{ insight.best }}</span>
                <span>max {{ insight.worst }}</span>
              </div>
              <span class="learn-panel__insight-rec">{{ insight.recommendation }}</span>
            </div>
          }
        </div>
      </div>

      <div class="learn-panel__card-output">
        <div class="learn-panel__section-label">Learned Patterns ({{ store.learnedPatterns().length }})</div>
        <div class="learn-panel__patterns">
          @for (p of store.learnedPatterns(); track p.id) {
            <details class="learn-panel__pattern">
              <summary class="learn-panel__pattern-header">
                <span class="learn-panel__pattern-cat" [class]="'cat--' + p.category">{{ p.category }}</span>
                <span class="learn-panel__pattern-desc">{{ p.pattern }}</span>
                <span class="learn-panel__pattern-conf">{{ (p.confidence * 100).toFixed(0) }}%</span>
              </summary>
              <div class="learn-panel__pattern-body">
                <div class="learn-panel__pattern-row">
                  <span>Occurrences: {{ p.occurrences }}</span>
                  <span>Last: {{ p.last_observed | date:'MMM d, HH:mm' }}</span>
                </div>
                <span class="learn-panel__pattern-impact">{{ p.impact }}</span>
              </div>
            </details>
          }
        </div>
      </div>

      <div class="learn-panel__actions">
        <button class="learn-panel__refresh" (click)="refresh()" [disabled]="store.loading()">
          {{ store.loading() ? '…' : '↻ Refresh Analysis' }}
        </button>
      </div>

      @if (store.error(); as err) {
        <div class="learn-panel__error">{{ err }}</div>
      }
    </div>
  `,
  styleUrl: './learn-panel.scss',
})
export class LearnPanel {
  protected readonly learnStore = inject(AssistantStore);

  protected refresh(): void {
    this.learnStore.refreshLearn();
  }
}
