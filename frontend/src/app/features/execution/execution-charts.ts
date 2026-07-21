import { Component, computed, effect, inject, signal } from '@angular/core';
import { SessionApiService, type ExecutionStatisticsDto, type ExecutionTraceDto, type SessionResponse } from '../../shared/api/session-api.service';
import { ReplayStore } from '../../shared/store/replay.store';

/**
 * Panel de telemetría — charts sincronizados con la ejecución/replay.
 *
 * Auto-carga los datos de la sesión activa (replay o última ejecución).
 * Muestra estadísticas, charts de posición/velocidad articular y timeline de eventos.
 */
@Component({
  selector: 'execution-charts',
  standalone: true,
  template: `
    <div class="ec">
      <!-- Session selector -->
      <div class="ec__toolbar">
        <select class="ec__select" [value]="selectedId()" (change)="onSelect($event)">
          <option value="0" disabled>Select session…</option>
          @for (s of sessionList(); track s.id) {
            <option [value]="s.id">#{{ s.id }} — {{ s.robot_name }} ({{ s.duration.toFixed(1) }}s, {{ s.source }})</option>
          }
        </select>
        @if (sessionList().length === 0) {
          <span class="ec__hint">No sessions yet</span>
        }
      </div>

      @if (error()) {
        <p class="ec__error">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="ec__loading">Loading…</p>
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
          <div class="ec__charts-row">
            <!-- Joint Position Chart -->
            <div class="ec__chart">
              <div class="ec__chart-header">Joint Positions</div>
              <svg class="ec__svg" [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH" preserveAspectRatio="none">
                @for (line of jointLines(); track $index) {
                  <polyline [attr.points]="line.points" [attr.stroke]="line.color" fill="none" stroke-width="1.5" />
                }
                @if (cursorPct() > 0) {
                  <line [attr.x1]="cursorPct() * svgW" y1="0" [attr.x2]="cursorPct() * svgW" [attr.y2]="svgH" stroke="#fff" stroke-width="1" stroke-dasharray="3,3" opacity="0.5" />
                }
              </svg>
              <div class="ec__chart-labels">
                <span>0s</span>
                <span class="ec__range">{{ jntMin().toFixed(2) }} – {{ jntMax().toFixed(2) }} rad</span>
                <span>{{ (t.metadata.duration || 1).toFixed(1) }}s</span>
              </div>
              <div class="ec__legend">
                @for (c of jointLegend(); track $index) {
                  <span class="ec__legend-item">
                    <span class="ec__legend-swatch" [style.background]="c.color"></span>
                    {{ c.label }}
                  </span>
                }
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
                <div class="ec__legend">
                  @for (c of velLegend(); track $index) {
                    <span class="ec__legend-item">
                      <span class="ec__legend-swatch" [style.background]="c.color"></span>
                      {{ c.label }}
                    </span>
                  }
                </div>
              </div>
            }
          </div>
        }

        <!-- Event Timeline -->
        @if (events().length > 0) {
          <div class="ec__timeline">
            <div class="ec__chart-header">Events</div>
            <div class="ec__events">
              @for (e of events(); track $index) {
                <div class="ec__event" (click)="onEventClick(e.timeSec)">
                  <span class="ec__event-time">{{ e.timeSec.toFixed(2) }}s</span>
                  <span class="ec__event-label">{{ e.label }}</span>
                  @if (e.detail) { <span class="ec__event-detail">{{ e.detail }}</span> }
                </div>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styleUrl: './execution-charts.scss',
})
export class ExecutionCharts {
  private readonly api = inject(SessionApiService);
  private readonly replayStore = inject(ReplayStore);

  protected readonly sessionList = signal<SessionResponse[]>([]);
  protected readonly selectedId = signal<number>(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<ExecutionStatisticsDto | null>(null);
  protected readonly trace = signal<ExecutionTraceDto | null>(null);

  protected readonly svgW = 300;
  protected readonly svgH = 80;

  readonly CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  protected readonly cursorPct = computed(() => this.replayStore.seekPos() / 100);

  constructor() {
    // Load session list on init
    this.loadSessions();

    // Auto-select session when replay starts
    effect(() => {
      const replayId = this.replayStore.sessionId();
      if (replayId !== null && replayId !== 0 && replayId !== this.selectedId()) {
        this.selectedId.set(replayId);
        this.loadData();
      }
    });
  }

  private loadSessions(): void {
    this.api.listSessions().subscribe({
      next: (list) => {
        this.sessionList.set(list);
        // Auto-select most recent session if none selected
        if (list.length > 0 && this.selectedId() === 0) {
          const latest = list.reduce((a, b) => a.id > b.id ? a : b);
          this.selectedId.set(latest.id);
          this.loadData();
        }
      },
      error: () => {},
    });
  }

  protected onSelect(event: Event): void {
    const val = parseInt((event.target as HTMLSelectElement).value, 10);
    if (!isNaN(val) && val > 0) {
      this.selectedId.set(val);
      this.loadData();
    }
  }

  protected loadData(): void {
    const id = this.selectedId();
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

  // ── Chart data builders ──

  /** Min y max de todas las posiciones articulares (para el label de rango). */
  protected readonly jntMin = computed(() => {
    const t = this.trace();
    if (!t?.samples?.length) return 0;
    let min = Infinity;
    for (const s of t.samples) for (const v of s.joints) if (v < min) min = v;
    return min === Infinity ? 0 : min;
  });
  protected readonly jntMax = computed(() => {
    const t = this.trace();
    if (!t?.samples?.length) return 0;
    let max = -Infinity;
    for (const s of t.samples) for (const v of s.joints) if (v > max) max = v;
    return max === -Infinity ? 0 : max;
  });

  /** Leyenda de colores del chart de posiciones. */
  protected readonly jointLegend = computed(() => {
    const t = this.trace();
    const n = t?.samples?.[0]?.joints?.length ?? 0;
    return Array.from({ length: n }, (_, j) => ({
      color: this.CHART_COLORS[j % this.CHART_COLORS.length],
      label: `Joint ${j}`,
    }));
  });

  /** Leyenda de colores del chart de velocidades. */
  protected readonly velLegend = computed(() => {
    const t = this.trace();
    const n = t?.samples?.[0]?.joints?.length ?? 0;
    if (n === 0) return [];
    return Array.from({ length: n }, (_, j) => ({
      color: this.CHART_COLORS[j % this.CHART_COLORS.length],
      label: `Joint ${j}`,
    }));
  });

  protected readonly jointLines = computed(() => {
    const t = this.trace();
    if (!t?.samples?.length) return [];
    const n = t.samples[0].joints.length;
    const duration = t.metadata.duration || 1;

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
          const x = (s.timestamp / duration) * this.svgW;
          const y = this.svgH - ((s.joints[j] - min) / range) * (this.svgH - 4) - 2;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return { points, color: this.CHART_COLORS[j % this.CHART_COLORS.length] };
    });
  });

  protected readonly velocityLines = computed(() => {
    const t = this.trace();
    if (!t?.samples?.length) return [];
    const n = t.samples[0].joints.length;
    const duration = t.metadata.duration || 1;

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
          const x = (t / duration) * this.svgW;
          const y = this.svgH - ((velSeries[j][i] - min) / range) * (this.svgH - 4) - 2;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return { points, color: this.CHART_COLORS[j % this.CHART_COLORS.length] };
    });
  });

  // ── Events ──

  /** Parse events — timestamp is now a f64 seconds from the API. */
  protected readonly events = computed(() => {
    const t = this.trace();
    if (!t?.events?.length) return [];
    return t.events.map(e => {
      const entry = Object.entries(e)[0];
      if (!entry) return null;
      const [kind, data] = entry as [string, { timestamp: number; waypoint?: number; segment?: number; message?: string }];
      const timeSec = data.timestamp ?? 0;
      let label = kind;
      let detail = '';
      if (kind === 'WaypointReached' && data.waypoint != null) detail = `WP ${data.waypoint}`;
      if (kind === 'SegmentCompleted') detail = `Seg ${data.segment}`;
      if (kind === 'Error' && data.message) detail = data.message;
      return { timeSec, label, detail };
    }).filter(Boolean) as { timeSec: number; label: string; detail: string }[];
  });

  protected onEventClick(timeSec: number): void {
    const t = this.trace();
    if (!t?.metadata?.duration) return;
    const pct = (timeSec / t.metadata.duration) * 100;
    this.replayStore.setSeekPos(Math.round(pct));
    this.api.seekExecution(pct / 100).subscribe();
  }
}
