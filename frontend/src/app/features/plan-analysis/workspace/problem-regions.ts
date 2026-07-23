import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import type { ProblemRegionDto } from '../plan-analysis-api.types';

type SeverityTier = 'critical' | 'warning' | 'info';

@Component({
  selector: 'problem-regions',
  standalone: true,
  imports: [NgIcon],
  template: `
    <div class="pr">
      <header class="pr__header">
        <h3 class="pr__title">Problem Regions</h3>
        <span class="pr__count">{{ totalFiltered() }} total</span>
      </header>

      @if (categories().length > 0) {
        <div class="pr__filters">
          <button
            class="pr__filter"
            [class.pr__filter--active]="activeFilter() === null"
            (click)="activeFilter.set(null)"
          >All ({{ allCount() }})</button>
          @for (cat of categories(); track cat) {
            <button
              class="pr__filter"
              [class.pr__filter--active]="activeFilter() === cat"
              (click)="activeFilter.set(cat)"
            >{{ cat }} ({{ catCount(cat) }})</button>
          }
        </div>
      }

      <!-- Collapsible groups -->
      @for (tier of tiers(); track tier) {
        @let regions = grouped()[tier];
        @if (regions && regions.length > 0) {
          <details class="pr__group" [open]="tier === 'critical'">
            <summary class="pr__group-summary" [class]="'pr__group-summary pr__group-summary--' + tier">
              <span class="pr__group-label">{{ tierLabel(tier) }}</span>
              <span class="pr__group-count">{{ regions.length }}</span>
            </summary>
            <div class="pr__group-body">
              @for (region of regions; track region.id) {
                <button
                  class="pr__card"
                  [class]="'pr__card pr__card--' + tier"
                  [class.pr__card--selected]="selectedRegionId() === region.id"
                  (click)="selectRegion(region)"
                >
                  <div class="pr__card-top">
                    <span class="pr__card-title">{{ regionTitle(region) }}</span>
                  </div>
                  <div class="pr__card-meta">
                    <span class="pr__card-kind">{{ categoryLabel(region.kind) }}</span>
                    <span class="pr__card-wp">{{ wpRange(region) }}</span>
                    @if (region.metrics) {
                      <span class="pr__card-count">{{ region.metrics.error_count + region.metrics.warning_count }} finding{{ (region.metrics.error_count + region.metrics.warning_count) !== 1 ? 's' : '' }}</span>
                    }
                  </div>
                </button>
              }
            </div>
          </details>
        }
      }
      @if (totalFiltered() === 0) {
        <p class="pr__empty">No regions match the selected filter.</p>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pr {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    /* ── Header ── */
    .pr__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pr__title {
      margin: 0;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
    }
    .pr__count {
      font-size: 0.75rem;
      color: #666;
      font-variant-numeric: tabular-nums;
    }

    /* ── Filter pills ── */
    .pr__filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    .pr__filter {
      font-family: inherit;
      font-size: 0.75rem;
      padding: 0.25rem 0.65rem;
      border-radius: 4px;
      border: 1px solid #333;
      background: transparent;
      color: #999;
      cursor: pointer;
      transition: all 0.12s;
    }
    .pr__filter:hover { background: #2a2a2a; color: #ccc; border-color: #444; }
    .pr__filter--active {
      background: #2a2a2a;
      color: #ddd;
      border-color: #558;
    }

    /* ── Collapsible groups ── */

    .pr__group {
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      overflow: hidden;
    }

    .pr__group-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      font-weight: 600;
      user-select: none;
      list-style: none;
      transition: background 0.12s;
    }
    .pr__group-summary::-webkit-details-marker { display: none; }
    .pr__group-summary::marker { display: none; content: ''; }

    .pr__group-summary:hover { background: #1e1e1e; }
    .pr__group-summary--critical { color: #cc5555; background: #1a0e0e; }
    .pr__group-summary--warning  { color: #ccaa33; background: #1a180c; }
    .pr__group-summary--info     { color: #5588aa; background: #0e141a; }

    .pr__group-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .pr__group-label::before {
      content: '▶';
      font-size: 0.65rem;
      transition: transform 0.15s;
      opacity: 0.5;
    }
    details[open] .pr__group-label::before {
      transform: rotate(90deg);
    }

    .pr__group-count {
      font-size: 0.75rem;
      font-weight: 600;
      opacity: 0.6;
      font-variant-numeric: tabular-nums;
    }

    .pr__group-body {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      padding: 0.375rem 0.5rem 0.5rem;
    }

    /* ── Region cards ── */

    .pr__card {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      text-align: left;
      font-family: inherit;
      width: 100%;
      padding: 0.75rem 0.85rem;
      border-radius: 6px;
      border: 1px solid transparent;
      border-left: 5px solid transparent;
      background: #181818;
      cursor: pointer;
      transition: all 0.12s;
    }
    .pr__card:hover {
      background: #202020;
    }
    .pr__card--selected {
      background: #1a1a28;
    }

    /* ── Severity variants ── */

    /* CRITICAL */
    .pr__card--critical {
      border-left-color: #cc5555;
      border-color: #cc555522;
      background: #1e1010;
    }
    .pr__card--critical:hover { background: #2a1515; }
    .pr__card--critical.pr__card--selected { background: #2a1515; border-color: #cc555544; }

    /* WARNING */
    .pr__card--warning {
      border-left-color: #ccaa33;
      border-color: #ccaa3322;
      background: #1e1a0e;
    }
    .pr__card--warning:hover { background: #2a2412; }
    .pr__card--warning.pr__card--selected { background: #2a2412; border-color: #ccaa3344; }

    /* INFO */
    .pr__card--info {
      border-left-color: #5588aa;
      border-color: #5588aa22;
      background: #0e141a;
    }
    .pr__card--info:hover { background: #141e28; }
    .pr__card--info.pr__card--selected { background: #141e28; border-color: #5588aa44; }

    /* ── Card content ── */

    .pr__card-top {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .pr__card-tag {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .pr__card-tag--critical {
      color: #cc5555;
      background: #cc555518;
    }
    .pr__card-tag--warning {
      color: #ccaa33;
      background: #ccaa3318;
    }
    .pr__card-tag--info {
      color: #5588aa;
      background: #5588aa18;
    }

    .pr__card-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #ddd;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pr__card-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.75rem;
      color: #777;
      padding-left: 0;
    }

    .pr__card-kind {
      text-transform: capitalize;
    }

    .pr__card-wp {
      font-family: monospace;
      color: #5588aa;
    }

    .pr__card-count {
      color: #888;
      font-variant-numeric: tabular-nums;
    }

    .pr__empty {
      font-size: 0.8125rem;
      color: #666;
      text-align: center;
      padding: 1.5rem 1rem;
    }
  `],
})
export class ProblemRegions {
  private readonly pa = inject(PlanAnalysisStore);

  protected readonly problemRegions = this.pa.problemRegions;
  protected readonly selectedRegionId = this.pa.selectedRegionId;
  protected readonly activeFilter = signal<string | null>(null);

  protected readonly allCount = computed(() => this.problemRegions().length);

  protected readonly categories = computed<string[]>(() => {
    const kinds = new Set(this.problemRegions().map(r => this.categoryLabel(r.kind)));
    return [...kinds].sort();
  });

  protected readonly totalFiltered = computed(() => this.filteredRegions.length);

  private get filteredRegions(): ProblemRegionDto[] {
    const filter = this.activeFilter();
    if (filter === null) return this.problemRegions();
    return this.problemRegions().filter(r => this.categoryLabel(r.kind) === filter);
  }

  protected readonly grouped = computed(() => {
    const groups: Record<SeverityTier, ProblemRegionDto[]> = {
      critical: [], warning: [], info: [],
    };
    for (const r of this.filteredRegions) {
      const tier = this.toTier(r);
      groups[tier].push(r);
    }
    return groups;
  });

  protected readonly tiers = signal<SeverityTier[]>(['critical', 'warning', 'info']);

  protected catCount(cat: string): number {
    return this.problemRegions().filter(r => this.categoryLabel(r.kind) === cat).length;
  }

  protected tierLabel(tier: SeverityTier): string {
    return tier === 'critical' ? 'Critical' : tier === 'warning' ? 'Warning' : 'Info';
  }

  protected selectRegion(region: ProblemRegionDto): void {
    const next = this.selectedRegionId() === region.id ? null : region.id;
    if (next === null) this.pa.clearSelection();
    else this.pa.selectRegion(region.id);
  }

  protected regionTitle(region: ProblemRegionDto): string {
    return region.explanation?.cause
      ?? region.kind.replace(/_/g, ' ');
  }

  /** Human-readable waypoint range. */
  protected wpRange(region: ProblemRegionDto): string {
    const s = region.waypoint_start;
    const e = region.waypoint_end;
    if (e === undefined || e === null || e === s) return `wp${s}`;
    return `wp${s}–wp${e}`;
  }

  protected categoryLabel(kind: string): string {
    const map: Record<string, string> = {
      collision: 'Collision',
      low_manipulability: 'Kinematic',
      singularity: 'Kinematic',
      low_clearance: 'Collision',
      joint_limit: 'Constraint',
      joint_velocity: 'Velocity',
      velocity: 'Velocity',
      tracking: 'Tracking',
    };
    return map[kind] ?? kind.replace(/_/g, ' ');
  }

  private toTier(region: ProblemRegionDto): SeverityTier {
    if (region.severity === 'critical' || region.severity === 'error') return 'critical';
    if (region.severity === 'warning') return 'warning';
    return 'info';
  }
}
