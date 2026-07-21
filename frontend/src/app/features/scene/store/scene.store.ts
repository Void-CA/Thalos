import { Injectable, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, concat, merge, Observable, of, Subject } from 'rxjs';
import { auditTime, catchError, distinctUntilChanged, map, scan, switchMap } from 'rxjs/operators';
import { SceneApiService } from '../services/scene-api.service';
import { toSceneData, toActivePlan, toToolFrame } from '../adapters/dto-to-model';
import type { RuntimeDelta, RuntimeStateResponse, SolveIKResponse, RotationDto } from '../scene-api.types';
import type { ActivePlan, ExecutionInfo, ExecutionStatus, IkCommand, IkResult, IkTarget, ObjectTransform, RuntimeInfo, SceneData, SceneState, SceneUiState, ToolFrame } from '../scene.types';

type SceneEvent =
  | { type: 'loading' }
  | { type: 'scene'; data: SceneData; runtime: RuntimeInfo; ikResult: IkResult | null; activePlan: ActivePlan | null; activeTcp: ToolFrame | null; execution: ExecutionInfo | null }
  | { type: 'fk-update'; data: SceneData; runtime: RuntimeInfo; ikResult: IkResult | null; activeTcp: ToolFrame | null }
  | { type: 'ik-executed'; data: SceneData; runtime: RuntimeInfo; ikResult: IkResult | null; activePlan: ActivePlan | null; activeTcp: ToolFrame | null }
  | { type: 'solve'; joints: number[]; ikResult: IkResult }
  | { type: 'target'; target: IkTarget | null }
  | { type: 'runtime-delta'; joints: number[]; transforms: ObjectTransform[]; execution: ExecutionInfo }
  | { type: 'error'; message: string };

const INITIAL_UI: SceneUiState = {
  loading: false,
  error: null,
};

const INITIAL_STATE: SceneState = {
  data: null,
  runtime: null,
  liveTransforms: [],
  execution: null,
  ikResult: null,
  solvedQ: null,
  ikTarget: null,
  activePlan: null,
  activeTcp: null,
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

  const execution: ExecutionInfo | null = res.execution
    ? {
        status: res.execution.status as ExecutionStatus,
        progress: res.execution.progress,
        elapsedSecs: res.execution.elapsed_secs,
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
    activeTcp: toToolFrame(res.active_tcp),
    execution,
  };
}

/** Map the FK response — same as scene but WITHOUT activePlan (FK never changes the plan). */
function toFkEvent(res: RuntimeStateResponse): SceneEvent {
  const ikResult: IkResult | null = res.ik_result
    ? {
        status: res.ik_result.status,
        iterations: res.ik_result.iterations,
        finalError: res.ik_result.final_error,
      }
    : null;

  return {
    type: 'fk-update',
    data: toSceneData(res.scene),
    runtime: {
      robot: res.robot,
      joints: res.joints,
      generatedAt: res.generated_at,
    },
    ikResult,
    activeTcp: toToolFrame(res.active_tcp),
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
    activeTcp: toToolFrame(res.active_tcp),
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

/** Map a RuntimeDelta (API) into a 'runtime-delta' event. */

/** Build a pose request from an IK target — safe narrowing of type === 'pose'. */
function toPoseRequest(target: IkTarget): { translation: [number, number, number]; rotation: RotationDto } | null {
  if (target.type !== 'pose' || !target.rotation) return null;
  return { translation: target.translation, rotation: target.rotation };
}
function toRuntimeDeltaEvent(delta: RuntimeDelta): SceneEvent {
  return {
    type: 'runtime-delta',
    joints: delta.joints,
    transforms: delta.transforms,
    execution: {
      status: delta.execution.status,
      progress: delta.execution.progress,
      elapsedSecs: delta.execution.elapsed_secs,
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

  /** Input stream: runtime delta updates (execution tick). */
  private readonly applyDeltaSubject = new Subject<RuntimeDelta>();

  /** Single source of truth: latest scene data + UI state. */
  readonly state$: Observable<SceneState> = merge(
    // Pipeline 1: joint angle changes → setJoints API
    // distinctUntilChanged AFTER auditTime: only compares samples that
    // actually survive the throttle, not every mousemove event.
    this.qSubject.pipe(
      auditTime(16),
      distinctUntilChanged((a, b) =>
        a.length === b.length && a.every((v, i) => v === b[i]),
      ),
      switchMap(q => concat(
        of({ type: 'loading' as const }),
        this.api.setJoints(q).pipe(
          map(toFkEvent),
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
        const poseReq = toPoseRequest(cmd.target);
        const req = poseReq
          ? this.api.moveToPose(poseReq, undefined)
          : this.api.moveToPosition(cmd.target.translation, undefined);
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
        const poseReq = toPoseRequest(target);
        const req = poseReq
          ? this.api.solveIkPose(poseReq, frame_id)
          : this.api.solveIkPosition(target.translation, frame_id);
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

    // Pipeline 8: runtime delta updates (execution tick).
    // Throttled to ~60 FPS — no benefit in rendering invisible intermediate states.
    this.applyDeltaSubject.pipe(
      auditTime(16),
      map(toRuntimeDeltaEvent),
    ),

    // Pipeline 9: URDF import → loadRobotFromUrdf API
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
        case 'fk-update':
          return {
            data: event.data,
            runtime: event.runtime,
            liveTransforms: [],
            execution: null,
            ikResult: event.ikResult,
            solvedQ: null,
            ikTarget: state.ikTarget,
            activePlan: state.activePlan, // FK never changes the plan
            activeTcp: event.activeTcp,
            ui: { loading: false, error: null },
          };
        case 'scene':
          return {
            data: event.data,
            runtime: event.runtime,
            liveTransforms: [],
            execution: event.execution,
            ikResult: event.ikResult,
            solvedQ: null,
            ikTarget: state.ikTarget,
            activePlan: event.activePlan,
            activeTcp: event.activeTcp,
            ui: { loading: false, error: null },
          };
        case 'ik-executed':
          return {
            data: event.data,
            runtime: event.runtime,
            liveTransforms: [],
            execution: null,
            ikResult: event.ikResult,
            solvedQ: event.runtime.joints,
            ikTarget: state.ikTarget,
            activePlan: event.activePlan,
            activeTcp: event.activeTcp,
            ui: { loading: false, error: null },
          };
        case 'runtime-delta':
          return {
            ...state,
            data: state.data, // same ref — no scene rebuild
            runtime: state.runtime
              ? { ...state.runtime, joints: event.joints }
              : null,
            liveTransforms: event.transforms,
            execution: event.execution,
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

  /** Inject a runtime delta (from execution tick). */
  applyRuntimeDelta(delta: RuntimeDelta): void {
    this.applyDeltaSubject.next(delta);
  }
}
