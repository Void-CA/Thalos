import { Component, computed, inject, signal } from '@angular/core';
import { SceneStore } from '../../../features/scene/store/scene.store';
import { SceneApiService } from '../../../features/scene/services/scene-api.service';
import { SessionApiService } from '../../api/session-api.service';
import { ReplayStore } from '../../store/replay.store';

/**
 * Pulse line at the very bottom — always visible, never collapsible.
 *
 * Shows system status + execution controls when active + playback controls
 * for replay sessions.
 */
@Component({
  selector: 'status-bar',
  standalone: true,
  styleUrl: './status-bar.scss',
  template: `
    <footer class="status-bar">
      <div class="status-bar__group">
        <!-- Execution source -->
        <span class="status-bar__item status-bar__item--backend">{{ execSource() }}</span>
        <span class="status-bar__sep">·</span>

        @let robot = robotInfo();
        <span class="status-bar__item">{{ robot }}</span>
        <span class="status-bar__sep">·</span>

        <!-- Execution state -->
        <span
          class="status-bar__item status-bar__item--exec"
          [class.status-bar__item--running]="execState() === 'Active'"
          [class.status-bar__item--paused]="execState() === 'Paused'"
          [class.status-bar__item--failed]="execState() === 'Failed' || execState() === 'Cancelled'"
          [class.status-bar__item--done]="execState() === 'Completed'"
        >
          {{ execLabel() }}
        </span>

        <!-- Execution controls (always visible when active) -->
        @if (execState() === 'Active' || execState() === 'Paused') {
          <span class="status-bar__sep">·</span>

          @if (execState() === 'Active') {
            <button class="status-bar__ctrl" (click)="onPause()" title="Pause">⏸</button>
            <button class="status-bar__ctrl status-bar__ctrl--stop" (click)="onStop()" title="Stop">⏹</button>
          }
          @if (execState() === 'Paused') {
            <button class="status-bar__ctrl status-bar__ctrl--resume" (click)="onResume()" title="Resume">▶</button>
            <button class="status-bar__ctrl status-bar__ctrl--stop" (click)="onStop()" title="Stop">⏹</button>
          }
        }

        <!-- Playback controls (seek slider) for replay -->
        @if (isReplay()) {
          <span class="status-bar__sep">·</span>
          <input
            type="range"
            class="status-bar__seek"
            min="0"
            max="100"
            [value]="seekPos()"
            (input)="onSeek($event)"
            title="Seek position"
          />
          <span class="status-bar__item">{{ seekPos() }}%</span>
        }

        @if (hasError()) {
          <span class="status-bar__sep">·</span>
          <span class="status-bar__item status-bar__item--error">
            ⚠ {{ errorCount() }}
          </span>
        }
      </div>

      <div class="status-bar__spacer"></div>

      <div class="status-bar__group">
        <span class="status-bar__item status-bar__item--time">{{ timestamp() }}</span>
      </div>
    </footer>
  `,
})
export class StatusBar {
  private readonly scene = inject(SceneStore);
  private readonly api = inject(SceneApiService);
  private readonly sessionApi = inject(SessionApiService);
  private readonly replayStore = inject(ReplayStore);

  protected readonly seekPos = this.replayStore.seekPos;
  protected readonly isReplay = this.replayStore.isReplay;

  /** Execution source label — Simulation, Hardware, or Replay #N. */
  protected readonly execSource = computed(() => {
    const rid = this.replayStore.sessionId();
    if (rid !== null) return `Replay #${rid}`;
    return 'Simulation';
  });

  protected readonly robotInfo = computed(() => {
    const rt = this.scene.state()?.runtime;
    if (!rt?.robot) return 'No robot';
    return `${rt.robot.display_name} · ${rt.robot.dof}DOF`;
  });

  protected readonly execState = computed(() => {
    const state = this.scene.state();
    const exe = state?.execution;
    return exe?.status || '—';
  });

  protected readonly execLabel = computed(() => {
    const st = this.execState();
    const exe = this.scene.state()?.execution;
    if (st === 'Active' && exe?.progress != null) {
      return `Running ${Math.round(exe.progress * 100)}%`;
    }
    return st;
  });

  protected readonly hasError = computed(() => {
    return !!this.scene.state()?.ui?.error;
  });

  protected readonly errorCount = computed(() => {
    return this.scene.state()?.ui?.error ? 1 : 0;
  });

  protected readonly timestamp = computed(() => {
    const rt = this.scene.state()?.runtime;
    if (!rt?.generatedAt) return '';
    try {
      const d = new Date(rt.generatedAt);
      return d.toLocaleTimeString();
    } catch {
      return '';
    }
  });

  // ── Execution actions ──

  protected onPause(): void {
    this.api.pauseExecution().subscribe({
      next: res => this.scene.applySnapshot(res),
    });
  }

  protected onResume(): void {
    this.api.resumeExecution().subscribe({
      next: res => this.scene.applySnapshot(res),
    });
  }

  protected onStop(): void {
    this.api.cancelExecution().subscribe({
      next: res => {
        this.scene.applySnapshot(res);
        this.replayStore.stopReplay();
      },
    });
  }

  // ── Seek control ──

  protected onSeek(event: Event): void {
    const input = event.target as HTMLInputElement;
    const pct = parseInt(input.value, 10);
    this.replayStore.setSeekPos(pct);
    this.sessionApi.seekExecution(pct / 100).subscribe();
  }
}
