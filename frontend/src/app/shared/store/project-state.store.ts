import { Injectable, computed, Signal, inject } from '@angular/core';
import { SceneStore } from '../../features/scene/store/scene.store';
import { PlanAnalysisStore } from '../../features/plan-analysis/store/plan-analysis.store';
import type { ProjectState } from '../types/project-state';

/**
 * Deriva el estado del proyecto a partir de señales existentes.
 *
 * SceneStore.state().activePlan   → determina no_robot / robot_loaded / plan_compiled
 * PlanAnalysisStore.hasResult()   → determina plan_analyzed
 *
 * Inyectable global — cualquier componente o store puede consumirlo.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStateStore {
  private readonly scene = inject(SceneStore);
  private readonly planAnalysis = inject(PlanAnalysisStore);

  /** Estado actual del proyecto. */
  readonly state: Signal<ProjectState> = computed(() => {
    const activePlan = this.scene.state().activePlan;
    const runtime = this.scene.state().runtime;

    if (!runtime?.robot) return 'no_robot';
    if (!activePlan) return 'robot_loaded';
    if (!this.planAnalysis.hasResult()) return 'plan_compiled';
    return 'plan_analyzed';
  });

  /** `true` cuando el estado es ≥ plan_compiled (el plan está compilado). */
  readonly isPlanCompiled = computed(() => {
    const s = this.state();
    return s === 'plan_compiled' || s === 'plan_analyzed';
  });

  /** `true` cuando el plan ya fue analizado. */
  readonly isPlanAnalyzed = computed(() => this.state() === 'plan_analyzed');
}
