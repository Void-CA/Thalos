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
  styles: `
    @use 'variables' as *;

    .pw {
      display: flex;
      flex-direction: column;
      gap: 0;
      height: 100%;
      overflow-y: auto;
      padding: $space-lg $space-lg $space-lg 1.25rem;
      background: $bg-surface;
      min-width: 320px;

      &::-webkit-scrollbar { width: 6px; }
      &::-webkit-scrollbar-thumb { background: $border-default; border-radius: 3px; }
      scrollbar-color: $border-default transparent;
      scrollbar-width: thin;
    }

    .pw__section {
      margin-bottom: $space-lg;
    }

    .pw__title {
      margin: 0 0 $space-sm;
      font-size: $text-sm;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: $text-muted;
    }
  `,
})
export class PlanningWorkspace {}
