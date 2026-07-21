import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AssistantStore } from '../../store/assistant.store';

@Component({
  selector: 'adapt-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="adapt-panel">
      @let store = adaptStore;
      @let events = store.adaptationEvents();

      <div class="adapt-panel__card-output">
        <div class="adapt-panel__section-label">
          Adaptation Events
          @let alerts = store.hasAdaptationAlerts();
          @if (alerts) {
            <span class="adapt-panel__alert-dot"></span>
          }
        </div>

        @if (events.length === 0) {
          <p class="adapt-panel__empty">No adaptation events recorded.</p>
        }

        <div class="adapt-panel__events">
          @for (ev of events; track ev.id) {
            <div class="adapt-panel__event"
              [class]="'event--' + ev.severity"
              [class.event--resolved]="ev.status === 'completed'"
            >
              <div class="adapt-panel__event-header">
                <span class="adapt-panel__event-sev"
                  [class]="'sev--' + ev.severity">
                  {{ ev.severity === 'critical' ? '!!' : ev.severity === 'warning' ? '!' : 'i' }}
                </span>
                <span class="adapt-panel__event-type">{{ ev.failure_type }}</span>
                <span class="adapt-panel__event-status"
                  [class]="'status--' + ev.status">
                  {{ ev.status }}
                </span>
              </div>

              <div class="adapt-panel__event-body">
                <p class="adapt-panel__event-adapt">{{ ev.adaptation }}</p>
                <div class="adapt-panel__event-meta">
                  <span>{{ ev.timestamp | date:'HH:mm:ss' }}</span>
                  @if (ev.recovery_time_ms > 0) {
                    <span>Recovery: {{ (ev.recovery_time_ms / 1000).toFixed(1) }}s</span>
                  }
                </div>
              </div>

              @if (ev.status === 'pending' || ev.status === 'active') {
                <div class="adapt-panel__event-actions">
                  <button class="adapt-panel__resolve" (click)="resolve(ev.id)">✓ Resolve</button>
                </div>
              }
            </div>
          }
        </div>
      </div>

      <div class="adapt-panel__actions">
        <button class="adapt-panel__refresh" (click)="refresh()" [disabled]="store.loading()">
          {{ store.loading() ? '…' : '↻ Refresh' }}
        </button>
      </div>

      @if (store.loading()) {
        <p class="adapt-panel__loading">Checking adaptation status…</p>
      }
      @if (store.error(); as err) {
        <div class="adapt-panel__error">{{ err }}</div>
      }
    </div>
  `,
  styleUrl: './adapt-panel.scss',
})
export class AdaptPanel {
  protected readonly adaptStore = inject(AssistantStore);

  protected refresh(): void {
    this.adaptStore.refreshAdapt();
  }

  protected resolve(id: string): void {
    this.adaptStore.resolveAdaptation(id);
  }
}
