import { Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanAnalysisStore } from '../../plan-analysis/store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import { PerspectiveStore } from '../../../shared/store/perspective.store';
import { AlternativesPanel } from '../../plan-analysis/components/alternatives-panel';
import type { RecommendationDto } from '../../plan-analysis/plan-analysis-api.types';

/**
 * Knowledge Workspace — centraliza el conocimiento derivado del análisis
 * del plan y lo convierte en acciones navegables.
 *
 * Layout: recommendations → evidence → alternatives
 */
@Component({
  selector: 'knowledge-workspace',
  standalone: true,
  imports: [NgIcon, AlternativesPanel],
  templateUrl: './knowledge-workspace.html',
  styleUrl: './knowledge-workspace.scss',
})
export class KnowledgeWorkspace {
  protected readonly pa = inject(PlanAnalysisStore);
  private readonly focus = inject(FocusService);
  private readonly perspective = inject(PerspectiveStore);

  // ── Recommendations grouped by impact ──

  protected readonly recsByImpact = computed(() => {
    const all = this.pa.recommendations();
    const high: RecommendationDto[] = [];
    const medium: RecommendationDto[] = [];
    const low: RecommendationDto[] = [];
    for (const r of all) {
      switch (r.impact) {
        case 'high': high.push(r); break;
        case 'medium': medium.push(r); break;
        case 'low': low.push(r); break;
      }
    }
    return { high, medium, low };
  });

  protected readonly hasRecs = computed(() =>
    this.pa.recommendations().length > 0,
  );

  // ── Evidence: findings with their categories ──

  protected readonly evidenceItems = computed(() => {
    const findings = this.pa.findings();
    return findings.slice(0, 20).map(f => ({
      kind: f.kind.replace(/_/g, ' '),
      severity: f.severity,
      waypoint: f.waypoint,
      message: f.message,
      value: f.value,
      category: this.categoryOf(f.kind),
    }));
  });

  protected readonly hasEvidence = computed(() =>
    this.pa.findings().length > 0,
  );

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

  // ── Helpers ──

  protected iconFor(sev: string): string {
    switch (sev) { case 'error': return '✗'; case 'warning': return '⚠'; default: return 'ℹ'; }
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

  protected get hasData(): boolean {
    return this.pa.recommendations().length > 0 || this.pa.findings().length > 0;
  }
}
