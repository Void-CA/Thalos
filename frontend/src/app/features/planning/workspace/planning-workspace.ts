import { Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PlanningPanel } from '../planning-panel';
import { TrajectoryColorPicker } from '../trajectory-color-picker';
import { PerspectiveStore } from '../../../shared/store/perspective.store';
import { ProjectStateStore } from '../../../shared/store/project-state.store';

/**
 * Planning Workspace — editor de programas con acceso a Analysis.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ Motion Program (scroll)              │
 *   │ ┌──────────────────────────────────┐ │
 *   │ │ Segment 1 — MoveJ               │ │
 *   │ │ Segment 2 — MoveL               │ │
 *   │ └──────────────────────────────────┘ │
 *   │                                      │
 *   │ Trajectory Color                     │
 *   │ [○ ○ ○]                              │
 *   │                                      │
 *   │ [Analyze trajectory]  ← navega a     │
 *   │                          Analysis     │
 *   └──────────────────────────────────────┘
 */
@Component({
  selector: 'planning-workspace',
  standalone: true,
  imports: [NgIcon, PlanningPanel, TrajectoryColorPicker],
  template: `
    <div class="pw">
      <div class="pw__section">
        <h2 class="pw__title">Motion Program</h2>
        <planning-panel />
      </div>
      <div class="pw__section">
        <h2 class="pw__title">Trajectory Color</h2>
        <trajectory-color-picker />
      </div>
      <div class="pw__toolbar">
        <button
          class="pw__analyze-btn"
          [disabled]="!projectState.isPlanCompiled()"
          (click)="navigateToAnalysis()"
        >
          <ng-icon name="heroChartBar" size="18" />
          Analyze trajectory
        </button>
      </div>
    </div>
  `,
  styleUrl: './planning-workspace.scss',
})
export class PlanningWorkspace {
  private readonly perspective = inject(PerspectiveStore);
  protected readonly projectState = inject(ProjectStateStore);

  /** Navegar al workspace de Analysis. */
  protected navigateToAnalysis(): void {
    this.perspective.setPerspective('analysis');
  }
}
