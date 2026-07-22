import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../../plan-analysis/store/plan-analysis.store';
import { PlanAnalysisApiService } from '../../plan-analysis/services/plan-analysis-api.service';
import { FocusService } from '../../../shared/services/focus.service';
import type { ProblemRegionDto, RepairOptionDto } from '../../plan-analysis/plan-analysis-api.types';

/**
 * Knowledge Workspace v1 — consume AnalysisReport y presenta ProblemRegions
 * como unidad primaria de interacción.
 */
@Component({
  selector: 'knowledge-workspace',
  standalone: true,
  imports: [NgIcon],
  templateUrl: './knowledge-workspace.html',
  styleUrl: './knowledge-workspace.scss',
})
export class KnowledgeWorkspace {
  protected readonly pa = inject(PlanAnalysisStore);
  protected readonly focus = inject(FocusService);
  private readonly api = inject(PlanAnalysisApiService);

  protected readonly selectedRegionId = signal<number | null>(null);
  protected readonly expandedRegionId = signal<number | null>(null);
  protected readonly repairOptions = signal<RepairOptionDto[]>([]);
  protected readonly optionsLoading = signal(false);
  protected readonly optionsCalled = signal(false);

  protected readonly regions = computed(() => this.pa.problemRegions());
  protected readonly healthScore = computed(() => this.pa.healthScore());
  protected readonly rawFindings = computed(() => this.pa.findings());

  protected readonly stats = computed(() => {
    const r = this.regions();
    let critical = 0, warnings = 0;
    for (const region of r) {
      if (region.severity === 'critical') critical++;
      else if (region.severity === 'warning') warnings++;
    }
    return { total: r.length, critical, warnings };
  });

  protected readonly hasData = computed(() =>
    this.regions().length > 0 || this.rawFindings().length > 0,
  );

  // ── Repair options ──

  protected fetchRepairOptions(): void {
    this.optionsLoading.set(true);
    this.optionsCalled.set(true);
    this.api.getRepairOptions().subscribe({
      next: (res) => {
        this.repairOptions.set(res.repairs);
        this.optionsLoading.set(false);
      },
      error: () => this.optionsLoading.set(false),
    });
  }

  protected optionsForRegion(regionId: number): RepairOptionDto[] {
    return this.repairOptions().filter(o => o.region_id === regionId);
  }

  // ── Actions ──

  protected toggleRegion(id: number): void {
    this.expandedRegionId.set(
      this.expandedRegionId() === id ? null : id,
    );
  }

  protected selectRegion(region: ProblemRegionDto): void {
    this.selectedRegionId.set(region.id);
    const center = Math.floor((region.waypoint_start + region.waypoint_end) / 2);
    this.focus.focusWaypoint(center,
      `${region.kind} wp${region.waypoint_start}-${region.waypoint_end}`);
  }

  protected findingsForRegion(region: ProblemRegionDto) {
    return this.rawFindings().filter(f =>
      f.waypoint != null
      && f.waypoint >= region.waypoint_start
      && f.waypoint <= region.waypoint_end
    );
  }

  // ── Helpers ──

  protected severityIcon(sev: string): string {
    switch (sev) {
      case 'critical': return '✗';
      case 'warning': return '⚠';
      default: return 'ℹ';
    }
  }

  protected formatScore(score: number | null): string {
    if (score == null) return '—';
    return score.toFixed(2);
  }

  protected kindLabel(kind: string): string {
    return kind.replace(/_/g, ' ');
  }

  protected severityClass(sev: string): string {
    return 'kw__sev--' + sev;
  }

  protected strategyLabel(strategy: string): string {
    return strategy.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
