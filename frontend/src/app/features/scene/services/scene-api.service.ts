import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { RuntimeStateResponse } from '../scene-api.types';

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
}
