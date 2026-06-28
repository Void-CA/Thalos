import { Injectable, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, concat, merge, Observable, of, Subject } from 'rxjs';
import { auditTime, catchError, distinctUntilChanged, map, scan, switchMap } from 'rxjs/operators';
import { SceneApiService } from '../services/scene-api.service';
import { toSceneData, toActivePlan } from '../adapters/dto-to-model';
import type { RuntimeStateResponse, SolveIKResponse } from '../scene-api.types';
import type { ActivePlan, IkCommand, IkResult, IkTarget, RuntimeInfo, SceneData, SceneState, SceneUiState } from '../scene.types';

type SceneEvent =
  | { type: 'loading' }
  | { type: 'scene'; data: SceneData; runtime: RuntimeInfo; ikResult: IkResult | null; activePlan: ActivePlan | null }
  | { type: 'ik-executed'; data: SceneData; runtime: RuntimeInfo; ikResult: IkResult | null; activePlan: ActivePlan | null }
  | { type: 'solve'; joints: number[]; ikResult: IkResult }
  | { type: 'target'; target: IkTarget | null }
  | { type: 'error'; message: string };

const INITIAL_UI: SceneUiState = {
  loading: false,
  error: null,
};

const INITIAL_STATE: SceneState = {
  data: null,
  runtime: null,
  ikResult: null,
  solvedQ: null,
  ikTarget: null,
  activePlan: null,
  ui: INITIAL_UI,
};

const DEFAULT_Q: number[] = [0, 0];

/** Map the API response into the internal (data + runtime + ik + plan) event. */
function toSceneEvent(res: RuntimeStateResponse): SceneEvent {
  const ikResult: IkResult | null = res.ik_result
    ? {
        status: res.ik_result.status,
        iterations: res.ik_result.iterations,
        finalError: res.ik_result.final_error,
      }
    : null;

  return {
    type: 'scene',
    data: toSceneData(res.scene),
    runtime: {
      robot: res.robot,
      joints: res.joints,
      generatedAt: res.generated_at,
    },
    ikResult,
    activePlan: toActivePlan(res.active_plan),
  };
}

/** Map the API response from a monolithic IK move (solves + executes). */
function toIkExecutedEvent(res: RuntimeStateResponse): SceneEvent {
  const ikResult: IkResult | null = res.ik_result
    ? {
        status: res.ik_result.status,
        iterations: res.ik_result.iterations,
        finalError: res.ik_result.final_error,
      }
    : null;

  return {
    type: 'ik-executed',
    data: toSceneData(res.scene),
    runtime: {
      robot: res.robot,
      joints: res.joints,
      generatedAt: res.generated_at,
    },
    ikResult,
    activePlan: toActivePlan(res.active_plan),
  };
}

/** Map a SolveIK response into a 'solve' event. */
function toSolveEvent(res: SolveIKResponse): SceneEvent {
  return {
    type: 'solve',
    joints: res.joints,
    ikResult: {
      status: res.ik_result.status,
      iterations: res.ik_result.iterations,
      finalError: res.ik_result.final_error,
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

  /** Input stream: import a robot from a URDF source string. */
  private readonly loadUrdfSubject = new Subject<string>();

  /** Input stream: IK commands (moveToPosition / moveToPose). */
  private readonly ikSubject = new Subject<IkCommand>();

  /** Input stream: solve IK (no mutation). */
  private readonly solveSubject = new Subject<{ target: IkCommand['target']; frame_id?: number }>();

  /** Input stream: execute solved Q (move robot). */
  private readonly executeSubject = new Subject<number[]>();

  /** Input stream: gizmo target position (no API call — just UX state). */
  private readonly targetSubject = new Subject<IkTarget | null>();

  /** Input stream: external state snapshots (MoveJ/MoveL results, etc.). */
  private readonly applySnapshotSubject = new Subject<RuntimeStateResponse>();

  /** Single source of truth: latest scene data + UI state. */
  readonly state$: Observable<SceneState> = merge(
    // Pipeline 1: joint angle changes → setJoints API
    this.qSubject.pipe(
      auditTime(16),
      distinctUntilChanged((a, b) =>
        a.length === b.length && a.every((v, i) => v === b[i]),
      ),
      switchMap(q => concat(
        of({ type: 'loading' as const }),
        this.api.setJoints(q).pipe(
          map(toSceneEvent),
          catchError(err =>
            of({ type: 'error' as const, message: err.message ?? 'FK failed' }),
          ),
        ),
      )),
    ),

    // Pipeline 2: robot load → loadRobot API
    this.loadRobotSubject.pipe(
      switchMap(id => concat(
        of({ type: 'loading' as const }),
        this.api.loadRobot(id).pipe(
          map(toSceneEvent),
          catchError(err =>
            of({ type: 'error' as const, message: err.message ?? 'Load failed' }),
          ),
        ),
      )),
    ),

    // Pipeline 3: monolithic IK move (solve + execute in one API call)
    this.ikSubject.pipe(
      switchMap(cmd => {
        const req = cmd.target.type === 'position'
          ? this.api.moveToPosition(cmd.target.translation, undefined)
          : this.api.moveToPose(
              {
                translation: cmd.target.translation,
                rotation: cmd.target.rotation!,
              },
              undefined,
            );
        return concat(
          of({ type: 'loading' as const }),
          req.pipe(
            map(toIkExecutedEvent),
            catchError(err =>
              of({ type: 'error' as const, message: err.message ?? 'IK execute failed' }),
            ),
          ),
        );
      }),
    ),

    // Pipeline 4: solve IK (no mutation — just returns q values)
    this.solveSubject.pipe(
      switchMap(({ target, frame_id }) => {
        const req = target.type === 'position'
          ? this.api.solveIkPosition(target.translation, frame_id)
          : this.api.solveIkPose(
              { translation: target.translation, rotation: target.rotation! },
              frame_id,
            );
        return concat(
          of({ type: 'loading' as const }),
          req.pipe(
            map(toSolveEvent),
            catchError(err =>
              of({ type: 'error' as const, message: err.message ?? 'IK solve failed' }),
            ),
          ),
        );
      }),
    ),

    // Pipeline 5: execute solved Q
    this.executeSubject.pipe(
      switchMap(joints => concat(
        of({ type: 'loading' as const }),
        this.api.executeIk(joints).pipe(
          map(toSceneEvent),
          catchError(err =>
            of({ type: 'error' as const, message: err.message ?? 'IK execute failed' }),
          ),
        ),
      )),
    ),

    // Pipeline 6: gizmo target position updates (local, no API)
    this.targetSubject.pipe(
      map(target => ({ type: 'target' as const, target })),
    ),

    // Pipeline 7: external state snapshots (MoveJ/MoveL results, etc.)
    this.applySnapshotSubject.pipe(
      map(toSceneEvent),
    ),

    // Pipeline 8: URDF import → loadRobotFromUrdf API
    this.loadUrdfSubject.pipe(
      switchMap(source => concat(
        of({ type: 'loading' as const }),
        this.api.loadRobotFromUrdf(source).pipe(
          map(toSceneEvent),
          catchError(err =>
            of({ type: 'error' as const, message: err.message ?? 'URDF import failed' }),
          ),
        ),
      )),
    ),
  ).pipe(
    scan((state, event): SceneState => {
      switch (event.type) {
        case 'loading':
          return { ...state, ui: { ...state.ui, loading: true, error: null } };
        case 'scene':
          return {
            data: event.data,
            runtime: event.runtime,
            ikResult: event.ikResult,
            solvedQ: null,
            ikTarget: state.ikTarget,
            activePlan: event.activePlan,
            ui: { loading: false, error: null },
          };
        case 'ik-executed':
          return {
            data: event.data,
            runtime: event.runtime,
            ikResult: event.ikResult,
            solvedQ: event.runtime.joints,
            ikTarget: state.ikTarget,
            activePlan: event.activePlan,
            ui: { loading: false, error: null },
          };
        case 'solve':
          return {
            ...state,
            ikResult: event.ikResult,
            solvedQ: event.joints,
            ui: { ...state.ui, loading: false },
          };
        case 'target':
          return { ...state, ikTarget: event.target };
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

  /** Import a robot from a raw URDF source string. */
  loadRobotFromUrdf(urdfSource: string): void {
    this.loadUrdfSubject.next(urdfSource);
  }

  /** Send an IK command (move-to-position or move-to-pose, mutates runtime). */
  moveToTarget(cmd: IkCommand): void {
    this.ikSubject.next(cmd);
  }

  /** Solve IK without mutating runtime — stores result in solvedQ. */
  solveIK(target: IkCommand['target']): void {
    this.solveSubject.next({ target });
  }

  /** Execute previously solved joint angles — moves robot. */
  executeIK(joints: number[]): void {
    this.executeSubject.next(joints);
  }

  /** Update the gizmo target position (no API call). */
  updateTarget(target: IkTarget | null): void {
    this.targetSubject.next(target);
  }

  /** Inject a full runtime state snapshot into the store (from MoveJ/MoveL, etc.). */
  applySnapshot(res: RuntimeStateResponse): void {
    this.applySnapshotSubject.next(res);
  }
}
