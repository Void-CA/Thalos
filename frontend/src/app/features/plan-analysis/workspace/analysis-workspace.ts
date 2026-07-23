import { Component, computed, effect, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { StatusBanner } from './status-banner';
import { ProblemRegions } from './problem-regions';
import { RegionInspector } from './region-inspector';
import { PerspectiveStore } from '../../../shared/store/perspective.store';
import { ProjectStateStore } from '../../../shared/store/project-state.store';
import { PlanAnalysisStore } from '../store/plan-analysis.store';
import { FocusService } from '../../../shared/services/focus.service';
import type { ProblemRegionDto } from '../plan-analysis-api.types';

type EmptyState = 'not-available' | 'not-analyzed' | 'ready';

interface BreadcrumbItem {
  label: string;
  action: 'go-planning' | 'go-overview' | null;
}

@Component({
  selector: 'analysis-workspace',
  standalone: true,
  imports: [NgIcon, StatusBanner, ProblemRegions, RegionInspector],
  templateUrl: './analysis-workspace.html',
  styleUrl: './analysis-workspace.scss',
})
export class AnalysisWorkspace {
  private readonly perspective = inject(PerspectiveStore);
  private readonly projectState = inject(ProjectStateStore);
  private readonly focus = inject(FocusService);
  protected readonly pa = inject(PlanAnalysisStore);

  /** Auto-enfocar el viewport en la región seleccionada. */
  private readonly focusEffect = effect(() => {
    const region = this.selectedRegion();
    if (region) {
      this.focus.request({
        target: { type: 'waypoint', index: region.waypoint_start },
        emphasis: 'strong',
        label: this.regionTitle(region),
      });
    }
  });

  protected readonly emptyState = computed<EmptyState>(() => {
    const state = this.projectState.state();
    if (state === 'no_robot' || state === 'robot_loaded') return 'not-available';
    if (state === 'plan_compiled' && !this.pa.hasResult()) return 'not-analyzed';
    return 'ready';
  });

  protected readonly selectedRegion = computed<ProblemRegionDto | null>(() => {
    const id = this.pa.selectedRegionId();
    if (id === null) return null;
    return this.pa.problemRegions().find(r => r.id === id) ?? null;
  });

  /** Dynamic breadcrumb that reflects navigation depth. */
  protected readonly breadcrumb = computed<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [
      { label: 'Planning', action: 'go-planning' },
      { label: 'Analysis', action: 'go-overview' },
    ];
    const region = this.selectedRegion();
    if (region) {
      const tier = region.severity === 'critical' || region.severity === 'error'
        ? 'Critical' : region.severity === 'warning' ? 'Warning' : 'Info';
      const idx = this.pa.problemRegions().indexOf(region) + 1;
      items.push({ label: tier, action: 'go-overview' });
      items.push({ label: `${idx}`, action: null });
    }
    return items;
  });

  protected onAnalyze(): void {
    this.pa.analyzePlan();
  }

  /** Volver a Planning. */
  protected goBack(): void {
    this.perspective.setPerspective('planning');
  }

  /** Volver a la vista general (deseleccionar región). */
  protected goToOverview(): void {
    this.pa.clearSelection();
  }

  /** Manejar click en breadcrumb. */
  protected onBreadcrumb(item: BreadcrumbItem): void {
    if (item.action === 'go-planning') this.goBack();
    else if (item.action === 'go-overview') this.goToOverview();
  }

  /** Human-readable title for a region. */
  private regionTitle(region: ProblemRegionDto): string {
    return region.explanation?.cause ?? region.kind.replace(/_/g, ' ');
  }
}
