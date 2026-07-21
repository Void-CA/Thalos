import { Component, computed, inject, signal } from '@angular/core';
import { SessionApiService, type ExecutionStatisticsDto, type ExecutionTraceDto } from '../../shared/api/session-api.service';
import { ReplayStore } from '../../shared/store/replay.store';

/**
 * Panel de telemetría — charts sincronizados con la ejecución/replay.
 *
 * Consume ExecutionTrace + ExecutionStatistics de la API.
 * Se sincroniza con ReplayStore para el cursor de playback.
 */
@Component({
  selector: 'execution-charts',
  standalone: true,
  template: `
    <div class="ec">
      <!-- Session selector -->
      <div class="ec__toolbar">
        <input
          type="number"
          class="ec__input"
          placeholder="Session #"
          [value]="sessionId()"
          (change)="onSessionChange($event)"
          min="1"
        />
        <button class="ec__btn ec__btn--load" (click)="loadData()" [disabled]="loading() || !sessionId()">
          {{ loading() ? '…' : 'Load' }}
        </button>
      </div>

      @if (error()) {
        <p class="ec__error">{{ error() }}</p>
      }

      @if (stats(); as s) {
        <!-- Statistics cards -->
        <div class="ec__stats">
          <div class="ec__stat"><span class="ec__stat-label">Duration</span><span class="ec__stat-val">{{ s.duration.toFixed(1) }}s</span></div>
          <div class="ec__stat"><span class="ec__stat-label">Samples</span><span class="ec__stat-val">{{ s.sample_count }}</span></div>
          <div class="ec__stat"><span class="ec__stat-label">Rate</span><span class="ec__stat-val">{{ s.sample_rate.toFixed(0) }} Hz</span></div>
          <div class="ec__stat"><span class="ec__stat-label">Path</span><span class="ec__stat-val">{{ s.path_length.toFixed(2) }} rad</span></div>
          <div class="ec__stat"><span class="ec__stat-label">Events</span><span class="ec__stat-val">{{ s.event_count }}</span></div>
          @if (s.max_tracking_error != null) {
            <div class="ec__stat"><span class="ec__stat-label">Max Error</span><span class="ec__stat-val">{{ s.max_tracking_error.toFixed(4) }}</span></div>
          }
        </div>

        @if (trace(); as t) {
          <!-- Joint Position Chart -->
          <div class="ec__chart">
            <div class="ec__chart-header">Joint Positions</div>
            <svg class="ec__svg" [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH" preserveAspectRatio="none">
              @for (line of jointLines(); track $index) {
                <polyline [attr.points]="line.points" [attr.stroke]="line.color" fill="none" stroke-width="1.5" />
              }
              <!-- Playback cursor -->
              @if (cursorPct() > 0) {
                <line [attr.x1]="cursorPct() * svgW" y1="0" [attr.x2]="cursorPct() * svgW" [attr.y2]="svgH" stroke="#fff" stroke-width="1" stroke-dasharray="3,3" opacity="0.5" />
              }
            </svg>
            <div class="ec__chart-labels">
              <span>0s</span>
              <span>{{ (t.metadata.duration || 1).toFixed(1) }}s</span>
            </div>
          </div>

          <!-- Joint Velocity Chart -->
          @if (s.avg_joint_velocity.length > 0) {
            <div class="ec__chart">
              <div class="ec__chart-header">Joint Velocities</div>
              <svg class="ec__svg" [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH" preserveAspectRatio="none">
                @for (line of velocityLines(); track $index) {
                  <polyline [attr.points]="line.points" [attr.stroke]="line.color" fill="none" stroke-width="1.5" />
                }
                @if (cursorPct() > 0) {
                  <line [attr.x1]="cursorPct() * svgW" y1="0" [attr.x2]="cursorPct() * svgW" [attr.y2]="svgH" stroke="#fff" stroke-width="1" stroke-dasharray="3,3" opacity="0.5" />
                }
              </svg>
            </div>
          }
        }

        <!-- Event Timeline -->
        @if (events(); as evts) {
          @if (evts.length > 0) {
            <div class="ec__timeline">
              <div class="ec__chart-header">Events</div>
              <div class="ec__events">
                @for (e of evts; track $index) {
                  <div class="ec__event" (click)="onEventClick(e.time)">
                    <span class="ec__event-time">{{ e.time.toFixed(2) }}s</span>
                    <span class="ec__event-label">{{ e.label }}</span>
                    @if (e.detail) { <span class="ec__event-detail">{{ e.detail }}</span> }
                  </div>
                }
              </div>
            </div>
          }
        }
      } @else {
        <p class="ec__empty">Enter a session ID and click Load to view execution data.</p>
      }
    </div>
  `,
  styles: `
    .ec {
      font-family: monospace;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .ec__toolbar {
      display: flex;
      gap: 0.3rem;
      align-items: center;
    }
    .ec__input {
      width: 80px;
      font-family: monospace;
      font-size: 0.72rem;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      border: 1px solid #555;
      background: #222;
      color: #ddd;
    }
    .ec__btn {
      font-family: monospace;
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      border: 1px solid #3399ff;
      background: #222;
      color: #3399ff;
      cursor: pointer;
      &:hover:not(:disabled) { background: #1a2a3a; }
      &:disabled { opacity: 0.4; cursor: default; }
    }
    .ec__error { color: #cc4444; font-size: 0.7rem; }
    .ec__empty { text-align: center; font-size: 0.72rem; opacity: 0.5; }
    .ec__stats { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .ec__stat {
      background: #2a2a2a;
      padding: 0.25rem 0.4rem;
      border-radius: 3px;
      border: 1px solid #444;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .ec__stat-label { font-size: 0.6rem; opacity: 0.5; text-transform: uppercase; }
    .ec__stat-val { font-size: 0.75rem; font-weight: 700; color: #33ccff; }
    .ec__chart { display: flex; flex-direction: column; gap: 0.15rem; }
    .ec__chart-header {
      font-size: 0.65rem;
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .ec__svg {
      width: 100%;
      height: 80px;
      background: #1a1a1a;
      border-radius: 3px;
      border: 1px solid #333;
    }
    .ec__chart-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.55rem;
      opacity: 0.4;
    }
    .ec__timeline { display: flex; flex-direction: column; gap: 0.2rem; }
    .ec__events { display: flex; flex-direction: column; gap: 0.1rem; }
    .ec__event {
      display: flex;
      gap: 0.4rem;
      font-size: 0.65rem;
      padding: 0.15rem 0.3rem;
      border-radius: 2px;
      cursor: pointer;
      &:hover { background: #2a2a2a; }
    }
    .ec__event-time { color: #33ccff; font-weight: 600; min-width: 5ch; }
    .ec__event-label { color: #ddd; }
    .ec__event-detail { opacity: 0.5; }
  `,
})
export class ExecutionCharts {
  private readonly api = inject(SessionApiService);
  private readonly replayStore = inject(ReplayStore);

  protected readonly sessionId = signal<number>(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<ExecutionStatisticsDto | null>(null);
  protected readonly trace = signal<ExecutionTraceDto | null>(null);

  // Chart dimensions
  protected readonly svgW = 300;
  protected readonly svgH = 80;

  readonly CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  protected readonly cursorPct = computed(() => this.replayStore.seekPos() / 100);

  protected onSessionChange(event: Event): void {
    const val = parseInt((event.target as HTMLInputElement).value, 10);
    this.sessionId.set(isNaN(val) ? 0 : val);
  }

  protected loadData(): void {
    const id = this.sessionId();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.api.getExecutionStatistics(id).subscribe({
      next: (s) => {
        this.stats.set(s);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.message ?? 'Failed to load statistics');
        this.loading.set(false);
      },
    });

    this.api.getExecutionTrace(id).subscribe({
      next: (t) => this.trace.set(t),
      error: () => {},
    });
  }

  /** Build SVG polyline points for joint positions. */
  protected readonly jointLines = computed(() => {
    const t = this.trace();
    if (!t?.samples?.length) return [];
    const n = t.samples[0].joints.length;
    const duration = t.metadata.duration || 1;
    const durSec = duration;

    // Find global min/max for scaling
    let min = Infinity, max = -Infinity;
    for (const s of t.samples) {
      for (const v of s.joints) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = (max - min) || 1;

    return Array.from({ length: n }, (_, j) => {
      const points = t.samples
        .map(s => {
          const x = (s.timestamp / durSec) * this.svgW;
          const y = this.svgH - ((s.joints[j] - min) / range) * (this.svgH - 4) - 2;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return { points, color: this.CHART_COLORS[j % this.CHART_COLORS.length] };
    });
  });

  /** Build SVG polyline points for velocities. */
  protected readonly velocityLines = computed(() => {
    const t = this.trace();
    if (!t?.samples?.length) return [];
    const n = t.samples[0].joints.length;
    const duration = t.metadata.duration || 1;
    const durSec = duration;

    // Estimate velocities from position deltas
    const velSeries: number[][] = Array.from({ length: n }, () => []);
    const times: number[] = [];

    for (let i = 1; i < t.samples.length; i++) {
      const dt = (t.samples[i].timestamp - t.samples[i - 1].timestamp) || 1e-6;
      times.push(t.samples[i].timestamp);
      for (let j = 0; j < n; j++) {
        velSeries[j].push((t.samples[i].joints[j] - t.samples[i - 1].joints[j]) / dt);
      }
    }

    if (times.length === 0) return [];

    let min = Infinity, max = -Infinity;
    for (const series of velSeries) {
      for (const v of series) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = (max - min) || 1;

    return Array.from({ length: n }, (_, j) => {
      const points = times
        .map((t, i) => {
          const x = (t / durSec) * this.svgW;
          const y = this.svgH - ((velSeries[j][i] - min) / range) * (this.svgH - 4) - 2;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return { points, color: this.CHART_COLORS[j % this.CHART_COLORS.length] };
    });
  });

  /** Format events for display. */
  protected readonly events = computed(() => {
    const t = this.trace();
    if (!t?.events?.length) return [];
    return t.events.map(e => {
      const entry = Object.entries(e)[0];
      if (!entry) return null;
      const [kind, data] = entry as [string, { timestamp: number; waypoint?: number; segment?: number; message?: string }];
      const time = data.timestamp ?? 0;
      let label = kind;
      let detail = '';
      if (kind === 'WaypointReached' && data.waypoint != null) detail = `WP ${data.waypoint}`;
      if (kind === 'SegmentCompleted') detail = `Seg ${data.segment}`;
      if (kind === 'Error' && data.message) detail = data.message;
      return { time, label, detail };
    }).filter(Boolean) as { time: number; label: string; detail: string }[];
  });

  protected onEventClick(time: number): void {
    const t = this.trace();
    if (!t?.metadata?.duration) return;
    const pct = (time / t.metadata.duration) * 100;
    this.replayStore.setSeekPos(Math.round(pct));
    this.api.seekExecution(pct / 100).subscribe();
  }
}
