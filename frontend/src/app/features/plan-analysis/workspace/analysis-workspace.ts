import { Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import { PerspectiveStore } from '../../../shared/store/perspective.store';
import { ExecutionCharts } from '../../execution/execution-charts';
import { AlternativesPanel } from '../components/alternatives-panel';
import type { FindingDto, RecommendationDto } from '../plan-analysis-api.types';

interface CategorySummary {
  label: string;
  color: string;
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  pct: number; // % of total findings
}

interface ProblemRegion {
  waypoint: number;
  count: number;
  severity: string;
  kinds: string[];
}

/**
 * Analysis Workspace v2 — dashboard de ingeniería con síntesis,
 * visualización y delegación a otras vistas.
 */
@Component({
  selector: 'analysis-workspace',
  standalone: true,
  imports: [NgIcon, ExecutionCharts, AlternativesPanel],
  templateUrl: './analysis-workspace.html',
  styleUrl: './analysis-workspace.scss',
})
export class AnalysisWorkspace {
  protected readonly pa = inject(PlanAnalysisStore);
  private readonly focus = inject(FocusService);
  private readonly perspective = inject(PerspectiveStore);

  // ── Executive Summary ──

  protected readonly vm = computed(() => {
    const summary = this.pa.summary();
    const metrics = this.pa.metrics();
    return {
      hasResult: summary !== null || this.pa.findings().length > 0,
      loading: this.pa.loading(),
      status: summary?.status ?? 'ok',
      score: summary?.score ?? 0,
      grade: summary?.grade ?? '',
      message: summary?.message ?? '',
      metrics,
    };
  });

  // ── Severity distribution ──

  protected readonly severityDist = computed(() => {
    const findings = this.pa.findings();
    const errors = findings.filter(f => f.severity === 'error').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    const infos = findings.filter(f => f.severity === 'info').length;
    const total = findings.length || 1;
    return { errors, warnings, infos, total,
      errPct: (errors / total) * 100,
      warnPct: (warnings / total) * 100,
      infoPct: (infos / total) * 100,
    };
  });

  // ── Category summary cards ──

  protected readonly categories = computed(() => {
    const findings = this.pa.findings();
    const total = findings.length || 1;
    const map = new Map<string, CategorySummary>();

    for (const f of findings) {
      const cat = this.findingCategory(f.kind);
      let c = map.get(cat.label);
      if (!c) {
        c = { label: cat.label, color: cat.color, total: 0, errors: 0, warnings: 0, infos: 0, pct: 0 };
        map.set(cat.label, c);
      }
      c.total++;
      if (f.severity === 'error') c.errors++;
      else if (f.severity === 'warning') c.warnings++;
      else c.infos++;
    }

    return Array.from(map.values())
      .map(c => ({ ...c, pct: (c.total / total) * 100 }))
      .sort((a, b) => b.total - a.total);
  });

  // ── Critical findings (solo los que requieren acción) ──

  protected readonly criticalFindings = computed(() => {
    return this.pa.findings()
      .filter(f => f.severity === 'error' || f.severity === 'warning')
      .slice(0, 5); // top 5
  });

  // ── Problem regions (waypoints con más issues) ──

  protected readonly problemRegions = computed(() => {
    const map = new Map<number, { count: number; severity: string; kinds: Set<string> }>();
    let maxCount = 0;

    for (const f of this.pa.findings()) {
      if (f.waypoint == null) continue;
      let r = map.get(f.waypoint);
      if (!r) {
        r = { count: 0, severity: 'info', kinds: new Set() };
        map.set(f.waypoint, r);
      }
      r.count++;
      r.kinds.add(f.kind);
      const sevOrder = { error: 3, warning: 2, info: 1 };
      if (sevOrder[f.severity as keyof typeof sevOrder] > sevOrder[r.severity as keyof typeof sevOrder]) {
        r.severity = f.severity;
      }
      if (r.count > maxCount) maxCount = r.count;
    }

    return Array.from(map.entries())
      .map(([waypoint, r]) => ({
        waypoint,
        count: r.count,
        severity: r.severity,
        kinds: Array.from(r.kinds),
        pct: maxCount > 0 ? (r.count / maxCount) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  });

  // ── Score breakdown (from alternatives data) ──

  protected readonly scoreBreakdown = computed(() => {
    const alt = this.pa.alternativesData();
    if (!alt?.original_breakdown?.length) return null;
    const maxVal = Math.max(...alt.original_breakdown.map(b => b.value), 1);
    return {
      items: alt.original_breakdown.map(b => ({
        name: b.name.replace(/_/g, ' '),
        value: b.value,
        pct: (b.value / maxVal) * 100,
      })),
    };
  });

  // ── Recommendations grouped ──

  protected readonly groupedRecs = computed(() => {
    const high: RecommendationDto[] = [];
    const medium: RecommendationDto[] = [];
    const low: RecommendationDto[] = [];
    for (const r of this.pa.recommendations()) {
      switch (r.impact) { case 'high': high.push(r); break; case 'medium': medium.push(r); break; case 'low': low.push(r); break; }
    }
    return { high, medium, low };
  });

  // ── Full findings (collapsible, con límite de preview) ──

  protected readonly fullFindings = computed(() => this.pa.findings());
  protected readonly showAllFindings = computed(() => false); // toggled by user

  // ── Actions ──

  protected onFindingFocus(waypoint: number | null): void {
    if (waypoint == null) return;
    this.focus.focusWaypoint(waypoint);
  }

  protected onFindingEdit(waypoint: number | null): void {
    // Switch to planning perspective with waypoint focused
    if (waypoint == null) return;
    this.focus.focusWaypoint(waypoint);
    this.perspective.setPerspective('planning');
  }

  protected onReanalyze(): void {
    this.pa.analyzePlan();
  }

  protected setShowAllFindings(v: boolean): void {
    // This would ideally be a signal, but for simplicity we toggle via the template
  }

  // ── Helpers ──

  protected scoreColor(score: number): string {
    if (score >= 90) return '#44cc44';
    if (score >= 70) return '#33ccff';
    if (score >= 50) return '#ffaa33';
    return '#cc4444';
  }

  protected severityIcon(severity: string): string {
    switch (severity) {
      case 'error': return '✗';
      case 'warning': return '⚠';
      default: return 'ℹ';
    }
  }

  protected findingCategory(kind: string): { label: string; color: string } {
    switch (kind) {
      case 'collision': case 'collision_near': return { label: 'Collision', color: '#ef4444' };
      case 'low_manipulability': case 'near_singularity': case 'singularity': case 'ik_suggestion':
        return { label: 'Kinematic', color: '#eab308' };
      case 'tracking_error': case 'tracking_spike': case 'joint_deviation':
        return { label: 'Tracking', color: '#f97316' };
      case 'velocity_deviation': return { label: 'Velocity', color: '#3b82f6' };
      case 'constraint_violation': return { label: 'Constraint', color: '#a855f7' };
      default: return { label: 'Unknown', color: '#6b7280' };
    }
  }

  protected get hasData(): boolean {
    return this.pa.summary() !== null || this.pa.findings().length > 0;
  }
}
