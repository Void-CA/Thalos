import { Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import { ExecutionCharts } from '../../execution/execution-charts';
import { AlternativesPanel } from '../components/alternatives-panel';
import { SceneStore } from '../../scene/store/scene.store';
import type { FindingDto, RecommendationDto } from '../plan-analysis-api.types';

/**
 * Analysis Workspace — dashboard de métricas, findings, recomendaciones
 * y alternativas. Reemplaza las tabs de análisis del BottomPanel con
 * un layout diseñado para comprensión, no para edición.
 *
 * Layout:
 *   Score + Summary (top)
 *   Metric cards row
 *   Findings (grouped by category, expandable)
 *   Recommendations
 *   Alternatives
 *   Charts / Telemetry
 *   Execution evidence
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
  private readonly scene = inject(SceneStore);

  // ── Plan Analysis data ──

  protected readonly vm = computed(() => {
    const summary = this.pa.summary();
    const metrics = this.pa.metrics();
    const findings = this.pa.findings();
    const recommendations = this.pa.recommendations();

    return {
      hasResult: summary !== null || findings.length > 0,
      loading: this.pa.loading(),
      status: summary?.status ?? 'ok',
      score: summary?.score ?? 0,
      grade: summary?.grade ?? '',
      message: summary?.message ?? '',
      metrics,
      findings,
      recommendations,
    };
  });

  /** True when navigation target is simulation mode (has execution data). */
  protected readonly hasExecutionData = computed(() => {
    return !!this.scene.state()?.execution;
  });

  // ── Findings grouped by kind+severity ──

  protected readonly groupedFindings = computed(() => {
    const map = new Map<string, {
      kind: string;
      severity: string;
      count: number;
      waypoints: number[];
      message: string;
      categoryLabel: string;
      categoryColor: string;
    }>();

    for (const f of this.pa.findings()) {
      const key = `${f.severity}::${f.kind}`;
      let g = map.get(key);
      if (!g) {
        const cat = this.findingCategory(f.kind);
        g = {
          kind: f.kind, severity: f.severity, count: 0,
          waypoints: [], message: f.message,
          categoryLabel: cat.label, categoryColor: cat.color,
        };
        map.set(key, g);
      }
      g.count++;
      if (f.waypoint != null) {
        g.waypoints.push(f.waypoint);
      }
    }

    const severityOrder = { error: 0, warning: 1, info: 2 };
    return Array.from(map.values()).sort(
      (a, b) => (severityOrder[a.severity as keyof typeof severityOrder] ?? 9)
                - (severityOrder[b.severity as keyof typeof severityOrder] ?? 9),
    );
  });

  // ── Recommendations grouped by impact ──

  protected readonly groupedRecommendations = computed(() => {
    const high: RecommendationDto[] = [];
    const medium: RecommendationDto[] = [];
    const low: RecommendationDto[] = [];

    for (const r of this.pa.recommendations()) {
      switch (r.impact) {
        case 'high': high.push(r); break;
        case 'medium': medium.push(r); break;
        case 'low': low.push(r); break;
      }
    }

    return { high, medium, low };
  });

  // ── Execution evidence (from plan findings that are execution-related) ──

  protected readonly executionFindings = computed(() => {
    const findings = this.pa.findings();
    if (findings.length === 0) return [];

    const execKinds = new Set([
      'tracking_error', 'tracking_spike', 'joint_deviation', 'velocity_deviation',
    ]);

    const map = new Map<string, {
      kind: string;
      severity: string;
      count: number;
      message: string;
      value: number | null;
      categoryLabel: string;
      categoryColor: string;
    }>();

    for (const f of findings) {
      if (!execKinds.has(f.kind)) continue;
      const key = `${f.severity}::${f.kind}`;
      let g = map.get(key);
      if (!g) {
        const cat = this.findingCategory(f.kind);
        g = {
          kind: f.kind, severity: f.severity, count: 0,
          message: f.message, value: f.value ?? null,
          categoryLabel: cat.label, categoryColor: cat.color,
        };
        map.set(key, g);
      }
      g.count++;
      if (!g.message) g.message = f.message;
    }

    const severityOrder = { error: 0, warning: 1, info: 2 };
    return Array.from(map.values()).sort(
      (a, b) => (severityOrder[a.severity as keyof typeof severityOrder] ?? 9)
                - (severityOrder[b.severity as keyof typeof severityOrder] ?? 9),
    );
  });

  protected readonly reasoningState = computed(() => {
    const planFindings = this.pa.findings().map(f => ({
      kind: f.kind,
      severity: f.severity,
      waypoint: f.waypoint,
      value: f.value,
      catLabel: this.findingCategory(f.kind).label,
      catColor: this.findingCategory(f.kind).color,
    }));

    const wpFindings = this.pa.findings().filter(f => f.waypoint != null);
    const regionMap = new Map<string, { waypoint: number; severity: string; catLabel: string; catColor: string }>();
    for (const f of wpFindings) {
      if (f.waypoint == null) continue;
      const cat = this.findingCategory(f.kind);
      const key = `wp${f.waypoint}::${cat.label}`;
      if (!regionMap.has(key)) {
        regionMap.set(key, {
          waypoint: f.waypoint,
          severity: f.severity,
          catLabel: cat.label,
          catColor: cat.color,
        });
      }
    }

    return {
      planFindingsCount: planFindings.length,
      planFindings,
      problemRegions: Array.from(regionMap.values()),
    };
  });

  // ── Actions ──

  protected onFindingClick(waypoint: number | null): void {
    if (waypoint == null) return;
    this.focus.focusWaypoint(waypoint);
  }

  protected onRecommendationClick(waypoint: number | null): void {
    if (waypoint == null) return;
    this.focus.focusWaypoint(waypoint);
  }

  // ── Re-evaluate plan ──

  protected onReanalyze(): void {
    this.pa.analyzePlan();
  }

  // ── Navigation to related modes ──

  protected navigateToPlanning(): void {
    // This is handled by the shell via perspective store
    // The workspace emits an event or changes the perspective
  }

  // ── Helpers ──

  protected iconFor(severity: string): string {
    switch (severity) {
      case 'error': return 'ERR';
      case 'warning': return 'WRN';
      case 'info': return 'INF';
      default: return '--';
    }
  }

  protected scoreColor(score: number): string {
    if (score >= 90) return '#44cc44';
    if (score >= 70) return '#33ccff';
    if (score >= 50) return '#ffaa33';
    return '#cc4444';
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
