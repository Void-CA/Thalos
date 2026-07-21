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
  styles: `
    .sb { padding: 0.25rem; overflow-y: auto; font-family: monospace; }
    .sb__empty { text-align: center; font-size: 0.72rem; opacity: 0.5; padding: 1rem 0; }
    .sb__list { display: flex; flex-direction: column; gap: 0.3rem; }
    .sb__item {
      padding: 0.3rem;
      border-radius: 4px;
      background: #2a2a2a;
      border: 1px solid #444;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .sb__item:hover { border-color: #3399ff; }
    .sb__item--active { border-color: #3399ff; }
    .sb__item-header { display: flex; align-items: center; gap: 0.4rem; font-size: 0.7rem; }
    .sb__badge {
      padding: 0.1rem 0.3rem;
      border-radius: 2px;
      font-size: 0.6rem;
      font-weight: 700;
      background: #333;
      color: #888;
    }
    .sb__source { opacity: 0.6; }
    .sb__duration { margin-left: auto; }
    .sb__item-meta { font-size: 0.6rem; opacity: 0.5; display: flex; gap: 0.5rem; margin-top: 0.1rem; }
    .sb__btn {
      font-family: monospace;
      font-size: 0.65rem;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      border: 1px solid #44cc44;
      background: transparent;
      color: #44cc44;
      cursor: pointer;
      margin-top: 0.2rem;
    }
    .sb__btn:hover:not(:disabled) { background: #1a3a1a; }
    .sb__btn:disabled { opacity: 0.4; cursor: default; }
  `,
})
export class SessionBrowser {
  private readonly api = inject(SessionApiService);
  private readonly replayStore = inject(ReplayStore);
  private readonly scene = inject(SceneStore);

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
