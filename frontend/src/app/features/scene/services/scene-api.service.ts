import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SceneResponse } from '../scene.types';

@Injectable({ providedIn: 'root' })
export class SceneApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/api/v1';

  getSceneState(): Observable<SceneStateResponse> {
    return this.http.get<SceneStateResponse>(
      `${this.baseUrl}/scene`
    );
  }

  setJoints(jointAngles: number[]): Observable<SceneStateResponse> {
    return this.http.post<SceneStateResponse>(
      `${this.baseUrl}/scene/joints`,
      {
        joint_angles: jointAngles,
      }
    );
  }

  loadRobot(robotId: string): Observable<SceneStateResponse> {
    return this.http.post<SceneStateResponse>(
      `${this.baseUrl}/scene/robot`,
      {
        robot_id: robotId,
      }
    );
  }
}