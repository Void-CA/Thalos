import { Injectable, inject } from '@angular/core';
import { FocusService } from './focus.service';
import { ModeStore } from '../store/mode.store';
import type { RecommendationAction } from '../types/recommendation-action';

/**
 * Dispatches RecommendationActions into concrete UI operations.
 *
 * Translates a domain action into:
 *   - FocusRequest for camera/viewport navigation
 *   - Mode switching for panel context
 *
 * The AnalysisPanel calls `dispatch()` when the user clicks "Apply"
 * on a recommendation. No direct coupling between recommendations and UI.
 */
@Injectable({ providedIn: 'root' })
export class ActionDispatcher {
  private readonly focus = inject(FocusService);
  private readonly mode = inject(ModeStore);

  dispatch(action: RecommendationAction): void {
    switch (action.type) {
      case 'focus-waypoint':
        this.focus.focusWaypoint(action.waypoint);
        break;

      case 'select-ik-solution':
        // Focus the IK panel: switch to robot mode where IK tools live
        this.mode.setMode('robot');
        break;

      case 'open-ik-settings':
        // Same: IK settings are in robot mode
        this.mode.setMode('robot');
        break;

      case 'open-speed-settings':
        // Speed settings live in the planning segment editor
        this.mode.setMode('planning');
        break;

      case 'open-waypoint-editor':
        // Waypoint editing is in planning mode
        this.mode.setMode('planning');
        if (action.waypoint != null) {
          this.focus.focusWaypoint(action.waypoint);
        }
        break;

      case 'open-constraint-editor':
        // TODO: open constraint panel when implemented
        this.mode.setMode('robot');
        break;

      case 'open-tool-frame-settings':
        // TCP settings are in robot mode
        this.mode.setMode('robot');
        break;

      case 'open-scene-editor':
        // Scene editing is in planning mode
        this.mode.setMode('planning');
        break;
    }
  }
}
