import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { auditTime, catchError, distinctUntilChanged, map, scan, switchMap } from 'rxjs/operators';
import { SceneApiService } from '../services/scene-api.service';
import { SceneState, VisualScene } from '../scene.types';

type SceneEvent =
  | { type: 'scene'; scene: VisualScene }
  | { type: 'error'; message: string };

const INITIAL_STATE: SceneState = {
  scene: null,
  error: null,
};

const DEFAULT_Q: number[] = [0, 0];

@Injectable({ providedIn: 'root' })
export class SceneStore {
  private readonly api = inject(SceneApiService);

  /** Input stream: emit joint angles to trigger a new FK computation. */
  private readonly qSubject = new BehaviorSubject<number[]>(DEFAULT_Q);

  /** Single source of truth: latest scene + optional error. */
  readonly state$: Observable<SceneState> = this.qSubject.pipe(
    auditTime(16),
    distinctUntilChanged((a, b) =>
      a.length === b.length && a.every((v, i) => v === b[i]),
    ),
    switchMap(q =>
      this.api.getSceneFromFk(q).pipe(
        map(res => ({ type: 'scene' as const, scene: res.scene })),
        catchError(err =>
          of({ type: 'error' as const, message: err.message ?? 'FK failed' }),
        ),
      ),
    ),
    scan((state, event): SceneState => {
      switch (event.type) {
        case 'scene':
          return { scene: event.scene, error: null };
        case 'error':
          return { ...state, error: event.message };
      }
    }, INITIAL_STATE),
  );

  /** Push new joint angles into the pipeline. */
  setJointAngles(q: number[]): void {
    this.qSubject.next(q);
  }
}
