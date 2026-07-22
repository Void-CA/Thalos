import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { Subscription } from 'rxjs';
import { PlanAnalysisStore } from '../../plan-analysis/store/plan-analysis.store';
import { PlanAnalysisApiService } from '../../plan-analysis/services/plan-analysis-api.service';
import { FocusService } from '../../../shared/services/focus.service';
import type { ProblemRegionDto, RepairOptionDto } from '../../plan-analysis/plan-analysis-api.types';

/**
 * Knowledge Workspace v3 — sesión de reparación completa.
 */
@Component({
  selector: 'knowledge-workspace',
  standalone: true,
  imports: [NgIcon],
  templateUrl: './knowledge-workspace.html',
  styleUrl: './knowledge-workspace.scss',
})
export class KnowledgeWorkspace implements OnDestroy {
  protected readonly pa = inject(PlanAnalysisStore);
  protected readonly focus = inject(FocusService);
  private readonly api = inject(PlanAnalysisApiService);

  private subs = new Subscription();

  // ── Session state ──
  protected readonly sessionId = signal<number | null>(null);
  protected readonly revision = signal(0);
  protected readonly historyLength = signal(0);
  protected readonly sessionStatus = signal<string | null>(null);

  // ── Region state ──
  protected readonly selectedRegionId = signal<number | null>(null);
  protected readonly expandedRegionId = signal<number | null>(null);

  // ── Preview state ──
  protected readonly previewResult = signal<{ strategy: string; improvement: number; continuity: boolean; baseRevision: number } | null>(null);
  protected readonly previewLoading = signal(false);

  // ── Repair options from /repair/options ──
  protected readonly repairOptions = signal<RepairOptionDto[]>([]);
  protected readonly optionsLoading = signal(false);
  protected readonly optionsCalled = signal(false);

  // ── Data ──
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

  // ── Session lifecycle ──

  protected startSession(): void {
    this.subs.add(
      this.api.createSession().subscribe({
        next: (res) => {
          this.sessionId.set(res.session_id);
          this.revision.set(0);
          this.historyLength.set(0);
          this.sessionStatus.set('active');
          this.loadRepairOptions();
        },
      }),
    );
  }

  protected endSession(): void {
    const sid = this.sessionId();
    if (sid !== null) {
      this.subs.add(
        this.api.deleteSession(sid).subscribe({
          next: () => {
            this.sessionId.set(null);
            this.revision.set(0);
            this.historyLength.set(0);
            this.sessionStatus.set(null);
            this.previewResult.set(null);
          },
        }),
      );
    }
  }

  // ── Repair options ──

  protected loadRepairOptions(): void {
    this.optionsLoading.set(true);
    this.optionsCalled.set(true);
    this.subs.add(
      this.api.getRepairOptions().subscribe({
        next: (res) => {
          this.repairOptions.set(res.repairs);
          this.optionsLoading.set(false);
        },
        error: () => this.optionsLoading.set(false),
      }),
    );
  }

  protected optionsForRegion(regionId: number): RepairOptionDto[] {
    return this.repairOptions().filter(o => o.region_id === regionId);
  }

  // ── Preview ──

  protected requestPreview(regionId: number, strategy: string): void {
    const sid = this.sessionId();
    if (sid === null) return;

    this.previewLoading.set(true);
    this.subs.add(
      this.api.previewRepair(sid, { region_id: regionId, strategy }).subscribe({
        next: (res) => {
          this.previewResult.set({
            strategy,
            improvement: res.improvement,
            continuity: res.continuity_ok,
            baseRevision: res.base_revision,
          });
          this.previewLoading.set(false);
        },
        error: () => this.previewLoading.set(false),
      }),
    );
  }

  // ── Undo ──

  protected undoLast(): void {
    const sid = this.sessionId();
    if (sid === null) return;

    this.subs.add(
      this.api.undoRepair(sid).subscribe({
        next: (res) => {
          this.revision.set(res.new_revision);
          this.historyLength.set(res.history_length);
          this.pa.analyzePlan();
          this.previewResult.set(null);
        },
      }),
    );
  }

  // ── Apply ──

  protected applyRepair(): void {
    const sid = this.sessionId();
    if (sid === null) return;

    // TODO M8.4.4: candidate_id de la preview
    const candidateId = 0;
    this.subs.add(
      this.api.applyRepair(sid, { candidate_id: candidateId }).subscribe({
        next: (res) => {
          this.revision.set(res.new_revision);
          this.historyLength.set(res.history_length);
          // Refrescar análisis después de aplicar
          this.pa.analyzePlan();
          this.previewResult.set(null);
        },
      }),
    );
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
    switch (sev) { case 'critical': return '✗'; case 'warning': return '⚠'; default: return 'ℹ'; }
  }

  protected formatScore(score: number | null): string {
    return score == null ? '—' : score.toFixed(2);
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

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.sessionId() !== null) {
      this.endSession();
    }
  }
}
