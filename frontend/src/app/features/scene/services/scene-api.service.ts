import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RuntimeDelta, RuntimeStateResponse, SolveIKResponse, MoveToPositionRequest, MoveToPoseRequest, ExecuteIKRequest, MotionPlanRequest } from '../scene-api.types';
import { API_BASE_URL } from '../../../shared/api/api-config';

@Injectable({ providedIn: 'root' })
export class SceneApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  getSceneState(): Observable<RuntimeStateResponse> {
    return this.http.get<RuntimeStateResponse>(
      `${this.baseUrl}/scene`
    );
  }

  setJoints(jointAngles: number[]): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/joints`,
      {
        joint_angles: jointAngles,
      }
    );
  }

  loadRobot(robotId: string): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/robot`,
      {
        robot_id: robotId,
      }
    );
  }

  loadRobotFromUrdf(urdfSource: string): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/robot/from-urdf`,
      { urdf_source: urdfSource },
    );
  }

  moveToPosition(
    target: [number, number, number],
    frame_id?: number,
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/move-to-position`,
      { target, ...(frame_id !== undefined ? { frame_id } : {}) },
    );
  }

  moveToPose(
    target: MoveToPoseRequest['target'],
    frame_id?: number,
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/move-to-pose`,
      { target, ...(frame_id !== undefined ? { frame_id } : {}) },
    );
  }

  solveIkPosition(
    target: [number, number, number],
    frame_id?: number,
  ): Observable<SolveIKResponse> {
    return this.http.post<SolveIKResponse>(
      `${this.baseUrl}/scene/solve-ik-position`,
      { target, ...(frame_id !== undefined ? { frame_id } : {}) },
    );
  }

  solveIkPose(
    target: MoveToPoseRequest['target'],
    frame_id?: number,
  ): Observable<SolveIKResponse> {
    return this.http.post<SolveIKResponse>(
      `${this.baseUrl}/scene/solve-ik-pose`,
      { target, ...(frame_id !== undefined ? { frame_id } : {}) },
    );
  }

  executeIk(
    jointAngles: number[],
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/execute-ik`,
      { joint_angles: jointAngles },
    );
  }

  // ── Motion endpoints (MoveJ / MoveL) ──

  moveJ(target: number[], velocity?: number): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/motion/movej`,
      { target, ...(velocity !== undefined ? { velocity } : {}) },
    );
  }

  moveL(
    target: MoveToPoseRequest['target'],
    frame_id?: number,
    velocity?: number,
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/motion/movel`,
      { target, ...(frame_id !== undefined ? { frame_id } : {}), ...(velocity !== undefined ? { velocity } : {}) },
    );
  }

  // ── Motion plan (multi-segment program) ──

  /** Compile and preview a motion program (no execution). */
  previewPlan(request: MotionPlanRequest): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/motion/plan`,
      request,
    );
  }

  // ── Execution control ──

  startExecution(): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/motion/start`,
      {},
    );
  }

  pauseExecution(): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/motion/pause`,
      {},
    );
  }

  resumeExecution(): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/motion/resume`,
      {},
    );
  }

  cancelExecution(): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/motion/cancel`,
      {},
    );
  }

  resetExecution(): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/motion/reset`,
      {},
    );
  }

  // ── Execution tick ──

  /** Advance execution by `dt` seconds. Returns solo el delta (ligero). */
  tickExecution(dt: number): Observable<RuntimeDelta> {
    return this.http.post<RuntimeDelta>(
      `${this.baseUrl}/scene/motion/tick`,
      { dt },
    );
  }
}
