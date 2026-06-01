import { Injectable, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, merge, Observable, of, Subject } from 'rxjs';
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

  /** Input stream: joint angles → FK computation. */
  private readonly qSubject = new BehaviorSubject<number[]>(DEFAULT_Q);

  /** Input stream: load a different robot model into the scene. */
  private readonly loadRobotSubject = new Subject<string>();

  /** Single source of truth: latest scene data + UI state. */
  readonly state$: Observable<SceneState> = merge(
    // Pipeline 1: joint angle changes → setJoints API
    this.qSubject.pipe(
      auditTime(16),
      distinctUntilChanged((a, b) =>
        a.length === b.length && a.every((v, i) => v === b[i]),
      ),
      switchMap(q =>
        this.api.setJoints(q).pipe(
          map(toSceneEvent),
          catchError(err =>
            of({ type: 'error' as const, message: err.message ?? 'FK failed' }),
          ),
        ),
      ),
    ),

    // Pipeline 2: robot load → loadRobot API
    this.loadRobotSubject.pipe(
      switchMap(id =>
        this.api.loadRobot(id).pipe(
          map(toSceneEvent),
          catchError(err =>
            of({ type: 'error' as const, message: err.message ?? 'Load failed' }),
          ),
        ),
      ),
    ),
  ).pipe(
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

  /**
   * Señal derivada del pipeline RxJS.
   * Los componentes consumen esto en vez de subscribirse a state$.
   * El pipeline interno sigue siendo RxJS por auditTime, switchMap, merge, etc.
   */
  readonly state: Signal<SceneState> = toSignal(this.state$, {
    initialValue: INITIAL_STATE,
  });

  /** Push new joint angles into the pipeline. */
  setJointAngles(q: number[]): void {
    this.qSubject.next(q);
  }

  /** Load a different robot into the scene. */
  loadRobot(id: string): void {
    this.loadRobotSubject.next(id);
  }
}
