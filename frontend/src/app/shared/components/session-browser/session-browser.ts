import { Component, inject, signal } from '@angular/core';
import { SessionApiService, type SessionResponse } from '../../api/session-api.service';
import { ReplayStore } from '../../store/replay.store';
import { SceneStore } from '../../../features/scene/store/scene.store';

/**
 * Panel izquierdo de la perspectiva Sessions.
 * Lista ejecuciones registradas y permite seleccionar/reproducir.
 */
@Component({
  selector: 'session-browser',
  standalone: true,
  template: `
    <div class="sb">
      @if (sessions().length === 0) {
        <p class="sb__empty">No sessions yet. Execute a motion to create one.</p>
      } @else {
        <div class="sb__list">
          @for (s of sessions(); track s.id) {
            <div class="sb__item" [class.sb__item--active]="selectedId() === s.id" (click)="select(s.id)">
              <div class="sb__item-header">
                <span class="sb__badge" [class]="'badge--' + s.status.toLowerCase()">#{{ s.id }}</span>
                <span class="sb__source">{{ s.source }}</span>
                <span class="sb__duration">{{ s.duration.toFixed(1) }}s</span>
              </div>
              <div class="sb__item-meta">
                <span>{{ s.robot_name }}</span>
                <span>{{ s.joint_count }} DOF</span>
                <span class="sb__plan-id">plan: {{ s.plan_id }}</span>
              </div>
              <div class="sb__item-time">
                @if (s.completed_at) {
                  <span class="sb__ts">{{ formatTime(s.completed_at) }}</span>
                } @else if (s.started_at) {
                  <span class="sb__ts">{{ formatTime(s.started_at) }}</span>
                }
                @if (s.status !== 'Completed' && s.status !== 'Cancelled' && s.status !== 'Failed') {
                  <span class="sb__badge-running">● active</span>
                }
              </div>
              <button class="sb__btn" (click)="onReplay(s.id); $event.stopPropagation()" [disabled]="replaying()">
                {{ replaying() ? '…' : '▶ Replay' }}
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './session-browser.scss',
})
export class SessionBrowser {
  private readonly api = inject(SessionApiService);
  private readonly replayStore = inject(ReplayStore);
  private readonly scene = inject(SceneStore);

  protected formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }

  protected readonly sessions = signal<SessionResponse[]>([]);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly replaying = signal(false);

  constructor() {
    this.load();
  }

  private load(): void {
    this.api.listSessions().subscribe({
      next: (list) => this.sessions.set(list),
      error: () => {},
    });
  }

  protected select(id: number): void {
    this.selectedId.set(id);
  }

  protected onReplay(id: number): void {
    this.replaying.set(true);
    this.api.startReplay(id).subscribe({
      next: (res) => {
        this.replaying.set(false);
        this.scene.applySnapshot(res);
        this.replayStore.startReplay(id);
      },
      error: () => {
        this.replaying.set(false);
      },
    });
  }
}
