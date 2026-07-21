import { Component } from '@angular/core';
import { PlanningPanel } from '../planning-panel';
import { TrajectoryColorPicker } from '../trajectory-color-picker';

/**
 * Planning Workspace — editor de programas a la izquierda,
 * viewport 3D a la derecha (renderizado por el shell).
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ Motion Program (scroll)              │
 *   │ ┌──────────────────────────────────┐ │
 *   │ │ Segment 1 — MoveJ               │ │
 *   │ │ Segment 2 — MoveL               │ │
 *   │ │ +MoveJ  +MoveL                  │ │
 *   │ └──────────────────────────────────┘ │
 *   │                                      │
 *   │ [Preview]                             │
 *   │                                      │
 *   │ Trajectory Color                     │
 *   │ [○ ○ ○]                              │
 *   └──────────────────────────────────────┘
 */
@Component({
  selector: 'planning-workspace',
  standalone: true,
  imports: [PlanningPanel, TrajectoryColorPicker],
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
    </div>
  `,
  styleUrl: './planning-workspace.scss',
})
export class PlanningWorkspace {}
