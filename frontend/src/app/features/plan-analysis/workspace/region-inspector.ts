import { Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import type { ProblemRegionDto } from '../plan-analysis-api.types';

/**
 * Region Inspector — panel contextual que se abre al seleccionar
 * una Problem Region. Muestra métricas locales, detalle del finding,
 * y prepara el contexto para el timeline enfocado (slice 5) y
 * recomendaciones (slice 6).
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
            <button class="ri__action-btn" (click)="focusRegion()" title="Focus viewport on this region">
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
                  <span class="ri__metric-label">Average value</span>
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
              <div class="ri__metric">
                <span class="ri__metric-value">{{ region.metrics.waypoint_count }}</span>
                <span class="ri__metric-label">Waypoints</span>
              </div>
            </div>
          </div>
        }

        <!-- Consequence -->
        @if (region.explanation?.consequence) {
          <div class="ri__section">
            <h4 class="ri__section-title">Impact</h4>
            <p class="ri__text">{{ region.explanation.consequence }}</p>
          </div>
        }

        <!-- Waypoint range -->
        <div class="ri__section">
          <h4 class="ri__section-title">Location</h4>
          <div class="ri__inline">
            <span class="ri__tag">{{ wpRange(region) }}</span>
            @if (region.waypoint_count > 1) {
              <span class="ri__meta">{{ region.waypoint_count }} waypoints in range</span>
            }
          </div>
        </div>

        <!-- Recommended strategies (stub for slice 6) -->
        @if (strategies(region).length > 0) {
          <div class="ri__section">
            <h4 class="ri__section-title">Recommended Strategies</h4>
            <ul class="ri__strats">
              @for (s of strategies(region); track s) {
                <li class="ri__strat">
                  <ng-icon name="heroLightBulb" size="14" />
                  {{ s.replace(/_/g, ' ') }}
                </li>
              }
            </ul>
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

    /* Metrics grid */
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

    .ri__inline {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .ri__tag {
      font-family: monospace;
      font-size: 0.8125rem;
      color: #5588aa;
      background: #1a2a36;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .ri__meta {
      font-size: 0.75rem;
      color: #777;
    }

    /* Strategies */
    .ri__strats {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .ri__strat {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8125rem;
      color: #bbb;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      background: #1a1a1a;
      cursor: pointer;
      transition: background 0.12s;
    }
    .ri__strat:hover {
      background: #222;
      color: #ddd;
    }
    .ri__strat ng-icon { color: #ccaa33; flex-shrink: 0; }
  `],
})
export class RegionInspector {
  private readonly pa = inject(PlanAnalysisStore);
  private readonly focus = inject(FocusService);

  protected readonly selectedRegion = computed(() => {
    const id = this.pa.selectedRegionId();
    if (id === null) return null;
    return this.pa.problemRegions().find(r => r.id === id) ?? null;
  });

  protected clear(): void {
    this.pa.clearSelection();
  }

  /** Format a metric value: normal numbers to 4 decimals, very small to scientific. */
  protected fmt(val: number): string {
    if (val === 0) return '0';
    const abs = Math.abs(val);
    if (abs >= 0.001) return val.toFixed(4);
    if (abs >= 1e-6) return val.toFixed(6);
    return val.toExponential(2);
  }

  /** Human-readable waypoint range. */
  protected wpRange(region: ProblemRegionDto): string {
    const s = region.waypoint_start;
    const e = region.waypoint_end;
    if (e === undefined || e === null || e === s) return `wp${s}`;
    return `wp${s}–wp${e}`;
  }

  /** Re-enfocar el viewport en esta región. */
  protected focusRegion(): void {
    const region = this.selectedRegion();
    if (!region) return;
    this.focus.request({
      target: { type: 'waypoint', index: region.waypoint_start },
      emphasis: 'strong',
      label: this.regionTitle(region),
    });
  }

  private regionTitle(region: ProblemRegionDto): string {
    return region.explanation?.cause ?? region.kind.replace(/_/g, ' ');
  }

  /** Safe accessor for strategies array (avoids template narrowing issues). */
  protected strategies(region: ProblemRegionDto): string[] {
    return region.explanation?.recommended_strategies ?? [];
  }
}
