import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { Subscription } from 'rxjs';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { PlanAnalysisApiService } from '../services/plan-analysis-api.service';
import { FocusService } from '../../../shared/services/focus.service';
import type { ProblemRegionDto } from '../plan-analysis-api.types';
import type { PreviewResponse } from '../repair-session.types';

/**
 * Region Inspector — panel contextual con preview, apply y undo integrados.
 *
 * Cierra el ciclo OLCA dentro de Analysis: el usuario selecciona
 * una estrategia, previsualiza el cambio, lo aplica y puede deshacerlo
 * sin cambiar de contexto.
 */
@Component({
  selector: 'region-inspector',
  standalone: true,
  imports: [NgIcon],
  template: `
    @let region = selectedRegion();
    @if (region) {
      <div class="ri">
        <header class="ri__header">
          <h3 class="ri__title">Region Details</h3>
          <div class="ri__actions">
            <button class="ri__action-btn" (click)="focusRegion()" title="Focus viewport">
              <ng-icon name="heroMagnifyingGlassPlus" size="16" />
            </button>
            <button class="ri__close" (click)="clear()" title="Close">
              <ng-icon name="heroXMark" size="16" />
            </button>
          </div>
        </header>

        <!-- Cause -->
        @if (region.explanation?.cause) {
          <div class="ri__section">
            <p class="ri__cause">{{ region.explanation.cause }}</p>
          </div>
        }

        <!-- Metrics -->
        @if (region.metrics) {
          <div class="ri__section">
            <h4 class="ri__section-title">Metrics</h4>
            <div class="ri__metrics">
              @if (region.metrics.average_value != null) {
                <div class="ri__metric">
                  <span class="ri__metric-value">{{ fmt(region.metrics.average_value) }}</span>
                  <span class="ri__metric-label">Average</span>
                </div>
              }
              @if (region.metrics.min_value != null) {
                <div class="ri__metric">
                  <span class="ri__metric-value">{{ fmt(region.metrics.min_value) }}</span>
                  <span class="ri__metric-label">Min</span>
                </div>
              }
              @if (region.metrics.max_value != null) {
                <div class="ri__metric">
                  <span class="ri__metric-value">{{ fmt(region.metrics.max_value) }}</span>
                  <span class="ri__metric-label">Max</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Impact -->
        @if (region.explanation?.consequence) {
          <div class="ri__section">
            <h4 class="ri__section-title">Impact</h4>
            <p class="ri__text">{{ region.explanation.consequence }}</p>
          </div>
        }

        <!-- Location -->
        <div class="ri__section">
          <h4 class="ri__section-title">Location</h4>
          <span class="ri__tag">{{ wpRange(region) }}</span>
        </div>

        <!-- Strategies -->
        @if (strategies(region).length > 0) {
          <div class="ri__section">
            <h4 class="ri__section-title">Strategies</h4>
            <div class="ri__strats">
              @for (s of strategies(region); track s) {
                <button
                  class="ri__strat ri__strat--action"
                  [class.ri__strat--selected]="previewStrategy() === s"
                  (click)="previewAndSelect(s, region)"
                >
                  <ng-icon name="heroLightBulb" size="14" />
                  <span class="ri__strat-label">{{ s.replace(/_/g, ' ') }}</span>
                  @if (previewLoading() && previewStrategy() === s) {
                    <span class="ri__strat-spinner">...</span>
                  }
                </button>
              }
            </div>
          </div>
        }

        <!-- Preview error -->
        @if (previewError()) {
          <div class="ri__error">
            <ng-icon name="heroExclamationTriangle" size="14" />
            <span>{{ previewError() }}</span>
          </div>
        }

        <!-- Preview result -->
        @if (previewResult()) {
          <div class="ri__preview">
            <div class="ri__preview-row">
              <span class="ri__preview-label">Improvement</span>
              <span class="ri__preview-value" [class.ri__preview-value--pos]="(previewResult()?.improvement ?? 0) > 0">
                {{ previewResult()?.improvement?.toFixed(1) ?? '—' }}%
              </span>
            </div>
            <div class="ri__preview-row">
              <span class="ri__preview-label">Continuity</span>
              <span class="ri__preview-value" [class.ri__preview-value--ok]="previewResult()?.continuity_ok">
                {{ previewResult()?.continuity_ok ? 'OK' : 'Warning' }}
              </span>
            </div>
            <div class="ri__preview-actions">
              <button class="ri__btn ri__btn--apply" (click)="applyRepair()" [disabled]="applying()">
                {{ applying() ? 'Applying...' : 'Apply' }}
              </button>
              @if (historyCount() > 0) {
                <button class="ri__btn ri__btn--undo" (click)="undoRepair()" [disabled]="undoing()">
                  {{ undoing() ? 'Undoing...' : 'Undo' }}
                </button>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .ri {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.75rem;
      border-radius: 6px;
      border: 1px solid #2a2a2a;
      background: #141414;
    }
    .ri__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ri__title {
      margin: 0;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
    }
    .ri__actions {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .ri__action-btn {
      display: inline-flex;
      align-items: center;
      background: none;
      border: 1px solid #333;
      color: #5588aa;
      cursor: pointer;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      transition: all 0.12s;
    }
    .ri__action-btn:hover { background: #1a2a36; border-color: #5588aa; }
    .ri__close {
      display: inline-flex;
      align-items: center;
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 0.2rem;
      border-radius: 4px;
    }
    .ri__close:hover { color: #ccc; background: #222; }
    .ri__section {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .ri__section-title {
      margin: 0;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
    }
    .ri__cause {
      margin: 0;
      font-size: 0.9375rem;
      font-weight: 600;
      color: #ddd;
      line-height: 1.4;
    }
    .ri__text {
      margin: 0;
      font-size: 0.8125rem;
      color: #999;
      line-height: 1.5;
    }
    .ri__metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .ri__metric {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      padding: 0.4rem 0.5rem;
      border-radius: 4px;
      background: #1a1a1a;
    }
    .ri__metric-value {
      font-size: 0.9375rem;
      font-weight: 700;
      color: #33ccff;
      font-variant-numeric: tabular-nums;
    }
    .ri__metric-label {
      font-size: 0.6875rem;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .ri__tag {
      font-family: monospace;
      font-size: 0.8125rem;
      color: #5588aa;
      background: #1a2a36;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      align-self: flex-start;
    }
    .ri__strats {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .ri__strat {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-family: inherit;
      font-size: 0.8125rem;
      color: #bbb;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      background: #1a1a1a;
      border: 1px solid transparent;
      text-align: left;
      width: 100%;
      transition: all 0.12s;
    }
    .ri__strat:hover { background: #222; color: #ddd; }
    .ri__strat ng-icon { color: #ccaa33; flex-shrink: 0; }
    .ri__strat--action { cursor: pointer; }
    .ri__strat--selected {
      border-color: #ccaa3344;
      background: #1e1a0e;
    }
    .ri__strat-label { flex: 1; }
    .ri__strat-spinner { color: #ccaa33; font-weight: 700; }
    .ri__error {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      background: #2a1414;
      border: 1px solid #cc555544;
      color: #cc7777;
      font-size: 0.8125rem;
      line-height: 1.4;
    }
    .ri__error ng-icon { color: #cc5555; flex-shrink: 0; }
    .ri__preview {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem 0.75rem;
      border-radius: 6px;
      background: #0e1a14;
      border: 1px solid #2a3a2a;
    }
    .ri__preview-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ri__preview-label {
      font-size: 0.75rem;
      color: #888;
    }
    .ri__preview-value {
      font-size: 0.8125rem;
      font-weight: 700;
      color: #999;
      font-variant-numeric: tabular-nums;
    }
    .ri__preview-value--pos { color: #4a9e5a; }
    .ri__preview-value--ok { color: #4a9e5a; }
    .ri__preview-actions {
      display: flex;
      gap: 0.5rem;
      padding-top: 0.3rem;
    }
    .ri__btn {
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.12s;
    }
    .ri__btn:disabled { opacity: 0.4; cursor: default; }
    .ri__btn--apply {
      background: #4a9e5a;
      color: #111;
      border-color: #4a9e5a;
    }
    .ri__btn--apply:hover:not(:disabled) { background: #55b066; }
    .ri__btn--undo {
      background: transparent;
      color: #ccaa33;
      border-color: #ccaa3344;
    }
    .ri__btn--undo:hover:not(:disabled) { background: #1e1a0e; }
  `],
})
export class RegionInspector implements OnDestroy {
  private readonly pa = inject(PlanAnalysisStore);
  private readonly api = inject(PlanAnalysisApiService);
  private readonly focus = inject(FocusService);
  private readonly subs = new Subscription();

  // ── Selection ──

  protected readonly selectedRegion = computed(() => {
    const id = this.pa.selectedRegionId();
    if (id === null) return null;
    return this.pa.problemRegions().find(r => r.id === id) ?? null;
  });

  // ── Repair session ──

  protected readonly sessionId = signal<number | null>(null);
  protected readonly historyCount = signal(0);

  // ── Preview state ──

  protected readonly previewStrategy = signal<string | null>(null);
  protected readonly previewResult = signal<PreviewResponse | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewError = signal<string | null>(null);
  protected readonly applying = signal(false);
  protected readonly undoing = signal(false);

  // ── Focus ──

  protected focusRegion(): void {
    const region = this.selectedRegion();
    if (!region) return;
    this.focus.request({
      target: { type: 'waypoint', index: region.waypoint_start },
      emphasis: 'strong',
      label: this.regionTitle(region),
    });
  }

  // ── Preview ──

  protected previewAndSelect(strategy: string, region: ProblemRegionDto): void {
    const sid = this.ensureSession();
    if (!sid) return;

    this.previewStrategy.set(strategy);
    this.previewLoading.set(true);
    this.previewResult.set(null);
    this.previewError.set(null);
    this.subs.add(
      this.api.previewRepair(sid, { region_id: region.id, strategy }).subscribe({
        next: (res) => {
          this.previewResult.set(res);
          this.previewLoading.set(false);
        },
        error: (err) => {
          this.previewLoading.set(false);
          const msg = err?.error?.error ?? err?.message ?? 'Preview failed';
          this.previewError.set(msg);
        },
      }),
    );
  }

  // ── Apply ──

  protected applyRepair(): void {
    const sid = this.sessionId();
    const preview = this.previewResult();
    if (!sid || !preview) return;

    this.applying.set(true);
    this.subs.add(
      this.api.applyRepair(sid, { candidate_id: preview.candidate_id }).subscribe({
        next: (res) => {
          this.historyCount.set(res.history_length);
          this.applying.set(false);
          this.previewResult.set(null);
          this.previewStrategy.set(null);
          this.pa.analyzePlan();
        },
        error: () => this.applying.set(false),
      }),
    );
  }

  // ── Undo ──

  protected undoRepair(): void {
    const sid = this.sessionId();
    if (!sid) return;

    this.undoing.set(true);
    this.subs.add(
      this.api.undoRepair(sid).subscribe({
        next: (res) => {
          this.historyCount.set(res.history_length);
          this.undoing.set(false);
          this.previewResult.set(null);
          this.previewStrategy.set(null);
          this.pa.analyzePlan();
        },
        error: () => this.undoing.set(false),
      }),
    );
  }

  // ── Lifecycle ──

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ── Session management ──

  private ensureSession(): number | null {
    const existing = this.sessionId();
    if (existing !== null) return existing;

    this.subs.add(
      this.api.createSession().subscribe({
        next: (res) => this.sessionId.set(res.session_id),
      }),
    );
    return null;
  }

  // ── Helpers ──

  protected clear(): void {
    this.pa.clearSelection();
    this.previewResult.set(null);
    this.previewStrategy.set(null);
  }

  protected strategies(region: ProblemRegionDto): string[] {
    const fromBackend = region.recommended_strategies?.length
      ? region.recommended_strategies
      : region.explanation?.recommended_strategies;
    if (fromBackend?.length) return fromBackend;
    return this.defaultStrategies(region.kind);
  }

  protected wpRange(region: ProblemRegionDto): string {
    const s = region.waypoint_start;
    const e = region.waypoint_end;
    if (e === undefined || e === null || e === s) return `wp${s}`;
    return `wp${s}–wp${e}`;
  }

  protected fmt(val: number): string {
    if (val === 0) return '0';
    const abs = Math.abs(val);
    if (abs >= 0.001) return val.toFixed(4);
    if (abs >= 1e-6) return val.toFixed(6);
    return val.toExponential(2);
  }

  private regionTitle(region: ProblemRegionDto): string {
    return region.explanation?.cause ?? region.kind.replace(/_/g, ' ');
  }

  private defaultStrategies(kind: string): string[] {
    const map: Record<string, string[]> = {
      collision: ['Lift TCP', 'Insert waypoint', 'Adjust approach angle'],
      low_manipulability: ['Switch IK solver', 'Adjust TCP height', 'Insert waypoint'],
      singularity: ['Avoid singularity region', 'Switch IK solver', 'Adjust path'],
      low_clearance: ['Lift TCP', 'Adjust approach angle', 'Move obstacle'],
      joint_limit: ['Adjust joint range', 'Insert intermediate waypoint'],
      velocity: ['Reduce speed', 'Adjust acceleration profile'],
      tracking: ['Increase sample rate', 'Adjust tracking parameters'],
    };
    return map[kind] ?? ['Review waypoint parameters', 'Adjust trajectory constraints'];
  }
}
