import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { auditTime, catchError, distinctUntilChanged, map, scan, switchMap } from 'rxjs/operators';
import { SceneApiService } from '../services/scene-api.service';
import { toSceneData } from '../adapters/dto-to-model';
import type { RuntimeStateResponse } from '../scene-api.types';
import type { RuntimeInfo, SceneData, SceneState, SceneUiState } from '../scene.types';

type SceneEvent =
  | { type: 'scene'; data: SceneData; runtime: RuntimeInfo }
  | { type: 'error'; message: string };

const INITIAL_UI: SceneUiState = {
  loading: false,
  error: null,
};

const INITIAL_STATE: SceneState = {
  data: null,
  runtime: null,
  ui: INITIAL_UI,
};

const DEFAULT_Q: number[] = [0, 0];

/** Map the API response into the internal (data + runtime) event. */
function toSceneEvent(res: RuntimeStateResponse): SceneEvent {
  return {
    type: 'scene',
    data: toSceneData(res.scene),
    runtime: {
      robot: res.robot,
      joints: res.joints,
      generatedAt: res.generated_at,
    },
  };
}

@Injectable({ providedIn: 'root' })
export class SceneStore {
  private readonly api = inject(SceneApiService);

  /** Input stream: emit joint angles to trigger a new FK computation. */
  private readonly qSubject = new BehaviorSubject<number[]>(DEFAULT_Q);

  /** Single source of truth: latest scene data + UI state. */
  readonly state$: Observable<SceneState> = this.qSubject.pipe(
    auditTime(16),
    distinctUntilChanged((a, b) =>
      a.length === b.length && a.every((v, i) => v === b[i]),
    ),
    switchMap(q => {
      // Emit loading state before the API call
      // (handled by scan starting from previous state)

      return this.api.setJoints(q).pipe(
        map(toSceneEvent),
        catchError(err =>
          of({ type: 'error' as const, message: err.message ?? 'FK failed' }),
        ),
      );
    }),
    scan((state, event): SceneState => {
      switch (event.type) {
        case 'scene':
          return {
            data: event.data,
            runtime: event.runtime,
            ui: { loading: false, error: null },
          };
        case 'error':
          return {
            ...state,
            ui: { ...state.ui, loading: false, error: event.message },
          };
      }
    }, INITIAL_STATE),
  );

  /** Push new joint angles into the pipeline. */
  setJointAngles(q: number[]): void {
    this.qSubject.next(q);
  }
}
