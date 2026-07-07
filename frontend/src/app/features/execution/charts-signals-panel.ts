import { Component, computed, effect, inject, signal } from '@angular/core';
import { SceneStore } from '../scene/store/scene.store';
import {
  mockTorqueFromPosition,
  mockCurrentFromTorque,
  mockLatency,
  mockJitter,
  isSaturated,
  TORQUE_SATURATION_THRESHOLD,
} from './charts-signals.mock';

// ── Constants ──

const MAX_SAMPLES = 200;

const JOINT_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
];

// ── Component ──

@Component({
  selector: 'charts-signals-panel',
  standalone: true,
  template: `
    <div class="charts-signals-panel">
      @if (hasData()) {
        <!-- ══ Position sparklines ══ -->
        <div class="signal-group">
          <div class="signal-group__head">Position (rad)</div>
          <div class="signal-group__body">
            @for (i of jointIndices(); track i) {
              <div class="signal-row">
                <span class="signal-row__label" [style.color]="jColor(i)">{{ jn(i) }}</span>
                <canvas
                  [attr.data-spark]="'pos-' + i"
                  width="80"
                  height="30"
                  class="sparkline"
                ></canvas>
                <span class="signal-row__value">{{ lastPos(i) }}</span>
              </div>
            }
          </div>
        </div>

        <!-- ══ Velocity sparklines ══ -->
        <div class="signal-group">
          <div class="signal-group__head">Velocity (rad/s)</div>
          <div class="signal-group__body">
            @for (i of jointIndices(); track i) {
              <div class="signal-row">
                <span class="signal-row__label" [style.color]="jColor(i)">{{ jn(i) }}</span>
                <canvas
                  [attr.data-spark]="'vel-' + i"
                  width="80"
                  height="30"
                  class="sparkline"
                ></canvas>
                <span class="signal-row__value">{{ lastVel(i) }}</span>
              </div>
            }
          </div>
        </div>

        <!-- ══ Torque bars ══ -->
        <div class="signal-group">
          <div class="signal-group__head">Torque (Nm)</div>
          <div class="signal-group__body">
            @for (i of jointIndices(); track i) {
              <div class="signal-row">
                <span class="signal-row__label" [style.color]="jColor(i)">{{ jn(i) }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill"
                    [style.width.%]="trqPct(i)"
                    [style.background]="trqBarGradient(i)"
                  ></div>
                </div>
                <span class="signal-row__value">{{ trqVal(i) }}</span>
              </div>
            }
          </div>
        </div>

        <!-- ══ Current bars ══ -->
        <div class="signal-group">
          <div class="signal-group__head">Current (A)</div>
          <div class="signal-group__body">
            @for (i of jointIndices(); track i) {
              <div class="signal-row">
                <span class="signal-row__label" [style.color]="jColor(i)">{{ jn(i) }}</span>
                <div class="bar-track">
                  <div
                    class="bar-fill bar-fill--current"
                    [style.width.%]="curPct(i)"
                  ></div>
                </div>
                <span class="signal-row__value">{{ curVal(i) }}</span>
              </div>
            }
          </div>
        </div>

        <!-- ══ Status footer ══ -->
        <div class="status-footer">
          <span class="status-footer__item">
            Latency: <strong>{{ latency() }}ms</strong>
          </span>
          <span class="status-footer__sep">|</span>
          <span class="status-footer__item">
            Jitter: <strong>{{ jitter() }}ms</strong>
          </span>
        </div>

        @if (saturatedJoints().length > 0) {
          <div class="alert">
            <span class="alert__icon">⚠</span>
            Saturation:
            @for (j of saturatedJoints(); track j; let last = $last) {
              <strong>{{ jn(j) }}</strong>{{ last ? '' : ', ' }}
            }
            (torque)
          </div>
        }
      } @else {
        <div class="empty-state">
          <p class="empty-state__msg">No execution data</p>
          <p class="empty-state__hint">
            Load a robot and start an execution to see real-time signals.
          </p>
        </div>
      }
    </div>
  `,
  styleUrl: './charts-signals-panel.scss',
})
export class ChartsSignalsPanel {
  private readonly store = inject(SceneStore);

  // ── History buffers (mutable, not signals — drawn in rAF) ──

  private posHist: number[][] = [];
  private velHist: number[][] = [];
  private trqHist: number[][] = [];
  private curHist: number[][] = [];

  // ── Reactive derived / signal state ──

  protected readonly latestTorque = signal<number[]>([]);
  protected readonly latestCurrent = signal<number[]>([]);
  protected readonly latency = signal(0);
  protected readonly jitter = signal(0);
  protected readonly saturatedJoints = signal<number[]>([]);

  private lastTs = 0;
  private lastQ: number[] | null = null;
  private drawPending = false;
  private prevDof = 0;

  // ── Computed signals ──

  protected readonly dof = computed(() => this.store.state().runtime?.robot.dof ?? 0);

  protected readonly hasData = computed(
    () => this.store.state().runtime !== null && this.dof() > 0,
  );

  protected readonly jointNames = computed(
    () => (this.store.state().runtime?.robot.joints ?? []).map(j => j.name),
  );

  protected readonly jointIndices = computed(() =>
    Array.from<number>({ length: this.dof() }).map((_, i) => i),
  );

  // ── Constructor: effects ──

  constructor() {
    // Effect 1: resize buffers when DOF changes
    effect(() => {
      const n = this.dof();
      while (this.posHist.length < n) {
        this.posHist.push([]);
        this.velHist.push([]);
        this.trqHist.push([]);
        this.curHist.push([]);
      }
      if (this.posHist.length > n) {
        this.posHist.length = n;
        this.velHist.length = n;
        this.trqHist.length = n;
        this.curHist.length = n;
      }
    });

    // Effect 2: main data pipeline — reacts to every state change
    effect(() => {
      const s = this.store.state();
      const joints = s.runtime?.joints;
      if (!joints || joints.length === 0) {
        this.lastQ = null;
        this.lastTs = 0;
        return;
      }

      // Detect DOF change (e.g. robot reloaded) → reset derivative tracking
      const dof = this.dof();
      if (dof !== this.prevDof) {
        this.lastQ = null;
        this.lastTs = 0;
        this.prevDof = dof;
      }

      const now = performance.now();
      const dt =
        this.lastTs > 0 ? Math.max((now - this.lastTs) / 1000, 0.001) : 0.05;
      this.lastTs = now;

      // Update per-joint buffers
      const count = Math.min(joints.length, this.dof());
      for (let i = 0; i < count; i++) {
        // Position
        this.pushSample(this.posHist, i, joints[i]);

        // Velocity (finite difference)
        const vel =
          this.lastQ && dt > 0 ? (joints[i] - this.lastQ[i]) / dt : 0;
        this.pushSample(this.velHist, i, vel);

        // Mock torque: structural wave + noise
        const t = mockTorqueFromPosition(joints[i], now);
        this.pushSample(this.trqHist, i, t);

        // Mock current: proportional to torque + noise
        const c = mockCurrentFromTorque(t);
        this.pushSample(this.curHist, i, c);
      }
      this.lastQ = [...joints];

      // Push latest scalar values into signals (triggers template bindings)
      const tVals = this.trqHist.map(b => (b.length > 0 ? b[b.length - 1] : 0));
      const cVals = this.curHist.map(b => (b.length > 0 ? b[b.length - 1] : 0));
      this.latestTorque.set(tVals);
      this.latestCurrent.set(cVals);

      // Mock network stats
      this.latency.set(mockLatency());
      this.jitter.set(mockJitter());

      // Saturation detection
      this.saturatedJoints.set(
        tVals.map((v, i) => (isSaturated(v) ? i : -1)).filter(i => i >= 0),
      );

      // Schedule canvas redraw
      this.scheduleDraw();
    });
  }

  // ── Buffer helpers ──

  private pushSample(buf: number[][], idx: number, value: number): void {
    const a = buf[idx];
    if (!a) return;
    a.push(value);
    if (a.length > MAX_SAMPLES) a.shift();
  }

  // ── Template helpers ──

  protected jn(i: number): string {
    return this.jointNames()[i] ?? `J${i + 1}`;
  }

  protected lastPos(i: number): string {
    return (this.posHist[i]?.at(-1) ?? 0).toFixed(2);
  }

  protected lastVel(i: number): string {
    return (this.velHist[i]?.at(-1) ?? 0).toFixed(2);
  }

  protected trqPct(i: number): number {
    const v = this.latestTorque()[i] ?? 0;
    return Math.min(100, Math.max(0, (v / 1.0) * 100));
  }

  protected curPct(i: number): number {
    const v = this.latestCurrent()[i] ?? 0;
    return Math.min(100, Math.max(0, (v / 5.0) * 100));
  }

  protected trqVal(i: number): string {
    return (this.latestTorque()[i] ?? 0).toFixed(2);
  }

  protected curVal(i: number): string {
    return (this.latestCurrent()[i] ?? 0).toFixed(2);
  }

  protected jColor(i: number): string {
    return JOINT_COLORS[i % JOINT_COLORS.length];
  }

  protected trqBarGradient(i: number): string {
    const v = this.latestTorque()[i] ?? 0;
    if (v > 0.85) return 'linear-gradient(90deg, #cc4444, #ff6666)';
    if (v > 0.6) return 'linear-gradient(90deg, #ffaa33, #ffcc66)';
    return 'linear-gradient(90deg, #44cc44, #66ee66)';
  }

  // ── Canvas drawing (throttled via rAF) ──

  private scheduleDraw(): void {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => {
      this.drawPending = false;
      this.renderAllSparklines();
    });
  }

  private renderAllSparklines(): void {
    for (let i = 0; i < this.dof(); i++) {
      const posCanvas = document.querySelector(
        `[data-spark="pos-${i}"]`,
      ) as HTMLCanvasElement | null;
      if (posCanvas)
        this.drawSparkline(posCanvas, this.posHist[i] ?? [], this.jColor(i));

      const velCanvas = document.querySelector(
        `[data-spark="vel-${i}"]`,
      ) as HTMLCanvasElement | null;
      if (velCanvas)
        this.drawSparkline(velCanvas, this.velHist[i] ?? [], this.jColor(i));
    }
  }

  private drawSparkline(
    canvas: HTMLCanvasElement,
    data: number[],
    color: string,
  ): void {
    const ctx = canvas.getContext('2d');
    if (!ctx || data.length < 2) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // ── Grid lines ──
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 0.5;
    for (let gy = h / 3; gy < h; gy += h / 3) {
      ctx.beginPath();
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(w, gy + 0.5);
      ctx.stroke();
    }

    // ── Data range with 10 % padding ──
    let mn = data[0];
    let mx = data[0];
    for (const v of data) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const spread = mx - mn || 1;
    const pad = spread * 0.1;
    const lo = mn - pad;
    const hi = mx + pad;
    const range = hi - lo;

    // ── Zero reference line ──
    const zy = ((0 - lo) / range) * (h - 4) + 2;
    if (zy >= 0 && zy <= h) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h - zy);
      ctx.lineTo(w, h - zy);
      ctx.stroke();
    }

    // ── Sparkline polyline ──
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = data.length;
    for (let j = 0; j < n; j++) {
      const x = (j / (n - 1)) * (w - 2) + 1;
      const y = ((data[j] - lo) / range) * (h - 4) + 2;
      const sy = h - y;
      if (j === 0) ctx.moveTo(x, sy);
      else ctx.lineTo(x, sy);
    }
    ctx.stroke();
  }
}
