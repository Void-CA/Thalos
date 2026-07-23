import { Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { StatusBanner } from './status-banner';
import { ProblemRegions } from './problem-regions';
import { RegionInspector } from './region-inspector';
import { PerspectiveStore } from '../../../shared/store/perspective.store';
import { ProjectStateStore } from '../../../shared/store/project-state.store';
import { PlanAnalysisStore } from '../store/plan-analysis.store';

type EmptyState = 'not-available' | 'not-analyzed' | 'ready';

/**
 * Analysis Workspace — vista completa de análisis del plan.
 *
 * Se renderiza como workspace propio (no inline en Planning).
 * El acceso es desde Planning mediante el botón "Analyze trajectory"
 * que navega a esta vista.
 */
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
  private readonly pa = inject(PlanAnalysisStore);

  protected readonly emptyState = computed<EmptyState>(() => {
    const state = this.projectState.state();
    if (state === 'no_robot' || state === 'robot_loaded') return 'not-available';
    if (state === 'plan_compiled' && !this.pa.hasResult()) return 'not-analyzed';
    return 'ready';
  });

  protected readonly selectedRegionId = this.pa.selectedRegionId;

  protected onAnalyze(): void {
    this.pa.analyzePlan();
  }

  /** Volver a Planning. */
  protected goBack(): void {
    this.perspective.setPerspective('planning');
  }
}
