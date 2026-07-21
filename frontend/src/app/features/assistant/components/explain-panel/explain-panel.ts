import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AssistantStore } from '../../store/assistant.store';

@Component({
  selector: 'explain-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="explain-panel">
      @let store = explainStore;
      @if (store.loading()) {
        <p class="explain-panel__loading">Re-evaluating decisions…</p>
      }

      @if (store.error(); as err) {
        <div class="explain-panel__error">{{ err }}</div>
      }

      @for (entry of store.explainEntries(); track entry.id) {
        <details class="explain-panel__card" [open]="entry.selected">
          <summary class="explain-panel__card-header">
            <span class="explain-panel__step">Step {{ entry.step }}</span>
            <span class="explain-panel__conf"
              [class.conf--high]="entry.confidence >= 0.9"
              [class.conf--med]="entry.confidence >= 0.75 && entry.confidence < 0.9"
              [class.conf--low]="entry.confidence < 0.75">
              {{ (entry.confidence * 100).toFixed(0) }}%
            </span>
          </summary>
          <div class="explain-panel__card-body">
            <div class="explain-panel__decision">{{ entry.decision }}</div>
            <div class="explain-panel__rationale">{{ entry.rationale }}</div>

            <div class="explain-panel__section-label">Reasoning Chain</div>
            <div class="explain-panel__chain">
              @for (step of entry.chain; track step.step) {
                <div class="explain-panel__chain-step">
                  <span class="explain-panel__chain-num">{{ step.step }}</span>
                  <div class="explain-panel__chain-body">
                    <span class="explain-panel__chain-desc">{{ step.description }}</span>
                    <span class="explain-panel__chain-why">{{ step.rationale }}</span>
                    <code class="explain-panel__chain-data">{{ step.data_snapshot }}</code>
                  </div>
                </div>
              }
            </div>

            @if (entry.alternatives.length > 0) {
              <div class="explain-panel__section-label">Alternatives Considered</div>
              <ul class="explain-panel__alts">
                @for (alt of entry.alternatives; track alt) {
                  <li class="explain-panel__alt">{{ alt }}</li>
                }
              </ul>
            }

            <div class="explain-panel__meta">
              <span>{{ entry.timestamp | date:'HH:mm:ss' }}</span>
              <span class="explain-panel__id">{{ entry.id }}</span>
            </div>
          </div>
        </details>
      }

      <div class="explain-panel__actions">
        <button class="explain-panel__refresh" (click)="refresh()" [disabled]="explainStore.loading()">
          {{ explainStore.loading() ? '…' : '↻ Re-evaluate' }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './explain-panel.scss',
})
export class ExplainPanel {
  protected readonly explainStore = inject(AssistantStore);

  protected refresh(): void {
    this.explainStore.explainPlan();
  }
}
