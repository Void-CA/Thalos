import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import { PerspectiveStore } from '../../../shared/store/perspective.store';
import { ExecutionCharts } from '../../execution/execution-charts';
import { scoreBreakdownChart, severityChart } from '../../../shared/components/echart/chart-options';

interface CategorySummary {
  label: string;
  color: string;
  total: number;
  errors: number;
  warnings: number;
  pct: number;
}

interface ProblemRegion {
  waypoint: number;
  count: number;
  severity: string;
  kinds: string[];
  pct: number;
}

type AnalysisTab = 'dashboard' | 'charts';

/**
 * Analysis Workspace v3 — tabs con dashboard sintético y charts dedicados.
 *
 * Dashboard: pirámide overview→drill-down con grid horizontal.
 * Charts: telemetría de ejecución a fondo.
 */
@Component({
  selector: 'analysis-workspace',
  standalone: true,
  imports: [NgIcon, ExecutionCharts, NgxEchartsDirective],
  templateUrl: './analysis-workspace.html',
  styleUrl: './analysis-workspace.scss',
})
export class AnalysisWorkspace {
  protected readonly pa = inject(PlanAnalysisStore);
  private readonly focus = inject(FocusService);
  private readonly perspective = inject(PerspectiveStore);

  // ── Tabs ──

  protected readonly activeTab = signal<AnalysisTab>('dashboard');
  protected readonly setTab = (t: AnalysisTab) => this.activeTab.set(t);

  // ── Executive Summary ──

  protected readonly vm = computed(() => {
    const summary = this.pa.summary();
    return {
      hasResult: summary !== null || this.pa.findings().length > 0,
      loading: this.pa.loading(),
      status: summary?.status ?? 'ok',
      score: summary?.score ?? 0,
      grade: summary?.grade ?? '',
      message: summary?.message ?? '',
      metrics: this.pa.metrics(),
    };
  });

  // ── Severity distribution ──

  protected readonly severityDist = computed(() => {
    const f = this.pa.findings();
    const errors = f.filter(x => x.severity === 'error').length;
    const warnings = f.filter(x => x.severity === 'warning').length;
    const infos = f.filter(x => x.severity === 'info').length;
    const total = f.length || 1;
    return { errors, warnings, infos, total,
      errPct: (errors / total) * 100,
      warnPct: (warnings / total) * 100,
      infoPct: (infos / total) * 100,
    };
  });

  // ── Category summary ──

  protected readonly categories = computed(() => {
    const f = this.pa.findings();
    const total = f.length || 1;
    const map = new Map<string, CategorySummary>();

    for (const x of f) {
      const cat = this.categoryOf(x.kind);
      let c = map.get(cat.label);
      if (!c) {
        c = { label: cat.label, color: cat.color, total: 0, errors: 0, warnings: 0, pct: 0 };
        map.set(cat.label, c);
      }
      c.total++;
      if (x.severity === 'error') c.errors++;
      else if (x.severity === 'warning') c.warnings++;
    }

    return Array.from(map.values())
      .map(c => ({ ...c, pct: (c.total / total) * 100 }))
      .sort((a, b) => b.total - a.total);
  });

  // ── Critical findings (top 5) ──

  protected readonly criticalFindings = computed(() =>
    this.pa.findings().filter(f => f.severity === 'error' || f.severity === 'warning').slice(0, 5),
  );

  // ── Problem regions ──

  protected readonly problemRegions = computed(() => {
    const map = new Map<number, { count: number; severity: string; kinds: Set<string> }>();
    let maxCount = 0;

    for (const f of this.pa.findings()) {
      if (f.waypoint == null) continue;
      let r = map.get(f.waypoint);
      if (!r) { r = { count: 0, severity: 'info', kinds: new Set() }; map.set(f.waypoint, r); }
      r.count++;
      r.kinds.add(f.kind);
      const order = { error: 3, warning: 2, info: 1 };
      if (order[f.severity as keyof typeof order] > order[r.severity as keyof typeof order]) r.severity = f.severity;
      if (r.count > maxCount) maxCount = r.count;
    }

    return Array.from(map.entries())
      .map(([wp, r]) => ({ waypoint: wp, count: r.count, severity: r.severity, kinds: Array.from(r.kinds), pct: maxCount > 0 ? (r.count / maxCount) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  });

  // ── Waypoint severity map (for chart) ──

  protected readonly waypointSeverityMap = computed(() => {
    const findings = this.pa.findings();
    if (findings.length === 0) return [];
    const wpMap = new Map<number, { error: number; warning: number; info: number }>();
    for (const f of findings) {
      if (f.waypoint == null) continue;
      let wp = wpMap.get(f.waypoint);
      if (!wp) { wp = { error: 0, warning: 0, info: 0 }; wpMap.set(f.waypoint, wp); }
      if (f.severity === 'error') wp.error++;
      else if (f.severity === 'warning') wp.warning++;
      else wp.info++;
    }
    const entries = Array.from(wpMap.entries()).sort((a, b) => a[0] - b[0]);
    const maxTotal = Math.max(...entries.map(([, v]) => v.error + v.warning + v.info), 1);
    return entries.slice(0, 30).map(([wp, c]) => ({
      waypoint: wp, total: c.error + c.warning + c.info,
      error: c.error, warning: c.warning, info: c.info,
      pct: ((c.error + c.warning + c.info) / maxTotal) * 100,
    }));
  });

  // ── Score breakdown ──

  protected readonly scoreBreakdown = computed(() => {
    const alt = this.pa.alternativesData();
    if (!alt?.original_breakdown?.length) return null;
    const maxVal = Math.max(...alt.original_breakdown.map(b => b.value), 1);
    return { items: alt.original_breakdown.map(b => ({ name: b.name.replace(/_/g, ' '), value: b.value, pct: (b.value / maxVal) * 100 })) };
  });

  // ── ECharts options ──

  protected readonly scoreBreakdownOpts = computed<EChartsOption | null>(() => {
    const alt = this.pa.alternativesData();
    if (!alt?.original_breakdown?.length) return null;
    return scoreBreakdownChart(alt.original_breakdown);
  });

  protected readonly severityChartOpts = computed<EChartsOption | null>(() => {
    const cats = this.categories();
    if (cats.length === 0) return null;
    return severityChart(cats.map(c => ({ label: c.label, errors: c.errors, warnings: c.warnings, total: c.total })));
  });

  // ── Actions ──

  protected onFocus(waypoint: number | null): void {
    if (waypoint == null) return;
    this.focus.focusWaypoint(waypoint);
  }

  protected onEdit(waypoint: number | null): void {
    if (waypoint == null) return;
    this.focus.focusWaypoint(waypoint);
    this.perspective.setPerspective('planning');
  }

  protected onReanalyze(): void {
    this.pa.analyzePlan();
  }

  // ── Helpers ──

  protected scoreColor(score: number): string {
    if (score >= 90) return '#4a9e5a';
    if (score >= 70) return '#4a8ab5';
    if (score >= 50) return '#b8943a';
    return '#b85450';
  }

  protected categoryOf(kind: string): { label: string; color: string } {
    switch (kind) {
      case 'collision': case 'collision_near': return { label: 'Collision', color: '#b85450' };
      case 'low_manipulability': case 'near_singularity': case 'singularity': case 'ik_suggestion': return { label: 'Kinematic', color: '#b8943a' };
      case 'tracking_error': case 'tracking_spike': case 'joint_deviation': return { label: 'Tracking', color: '#c97d3a' };
      case 'velocity_deviation': return { label: 'Velocity', color: '#4a7a9a' };
      case 'constraint_violation': return { label: 'Constraint', color: '#7a5a9a' };
      default: return { label: 'Other', color: '#6a7a8a' };
    }
  }

  protected severityIcon(sev: string): string {
    switch (sev) { case 'error': return '✗'; case 'warning': return '⚠'; default: return 'ℹ'; }
  }

  protected barHeight(part: number, total: number): number {
    return Math.max(2, (part / total) * 60);
  }

  protected get hasData(): boolean {
    return this.pa.summary() !== null || this.pa.findings().length > 0;
  }
}
