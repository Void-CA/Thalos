import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SceneResponse } from '../scene.types';

@Injectable({ providedIn: 'root' })
export class SceneApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/api/v1';

  getSceneFromFk(q: number[]): Observable<SceneResponse> {
    return this.http.post<SceneResponse>(`${this.baseUrl}/scene/from-fk`, {
      joint_angles: q,
    });
  }
}
