import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RuntimeStateResponse, SolveIKResponse, MoveToPositionRequest, MoveToPoseRequest, ExecuteIKRequest } from '../scene-api.types';

@Injectable({ providedIn: 'root' })
export class SceneApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/api/v1';

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

  moveToPosition(
    target: [number, number, number],
    frame_id?: number,
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/move-to-position`,
      { target, frame_id } as MoveToPositionRequest,
    );
  }

  moveToPose(
    target: MoveToPoseRequest['target'],
    frame_id?: number,
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/move-to-pose`,
      { target, frame_id } as MoveToPoseRequest,
    );
  }

  solveIkPosition(
    target: [number, number, number],
    frame_id?: number,
  ): Observable<SolveIKResponse> {
    return this.http.post<SolveIKResponse>(
      `${this.baseUrl}/scene/solve-ik-position`,
      { target, frame_id } as MoveToPositionRequest,
    );
  }

  solveIkPose(
    target: MoveToPoseRequest['target'],
    frame_id?: number,
  ): Observable<SolveIKResponse> {
    return this.http.post<SolveIKResponse>(
      `${this.baseUrl}/scene/solve-ik-pose`,
      { target, frame_id } as MoveToPoseRequest,
    );
  }

  executeIk(
    jointAngles: number[],
  ): Observable<RuntimeStateResponse> {
    return this.http.post<RuntimeStateResponse>(
      `${this.baseUrl}/scene/execute-ik`,
      { joint_angles: jointAngles } as ExecuteIKRequest,
    );
  }
}
