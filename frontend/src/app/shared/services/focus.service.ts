import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { FocusRequest } from '../types/focus-request';

/**
 * Lightweight event bus for focus/navigation requests.
 *
 * Panels (AnalysisPanel, etc.) emit FocusRequests.
 * The SceneViewer subscribes and translates them into
 * camera movement + highlighting in Three.js.
 *
 * No direct coupling between producers and consumers.
 */
@Injectable({ providedIn: 'root' })
export class FocusService {
  /** Observable stream of focus requests. */
  readonly focus$ = new Subject<FocusRequest>();

  /** Emit a focus request. */
  request(req: FocusRequest): void {
    this.focus$.next(req);
  }

  /** Convenience: focus on a waypoint by index. */
  focusWaypoint(index: number, label?: string): void {
    this.request({
      target: { type: 'waypoint', index },
      emphasis: 'normal',
      label,
    });
  }

  /** Convenience: focus on a pose (position in 3D space). */
  focusPosition(position: [number, number, number], label?: string): void {
    this.request({
      target: { type: 'pose', position },
      emphasis: 'normal',
      label,
    });
  }

  /** Convenience: focus based on a finding. */
  focusFinding(kind: string, waypoint?: number | null, label?: string): void {
    this.request({
      target: { type: 'finding', kind, waypoint },
      emphasis: 'normal',
      label,
    });
  }
}
