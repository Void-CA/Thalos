import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { RobotMetadataDto } from '../robot-api.types';
import { API_BASE_URL } from '../../../shared/api/api-config';

@Injectable({ providedIn: 'root' })
export class RobotApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  getRobots(): Observable<RobotMetadataDto[]> {
    return this.http.get<RobotMetadataDto[]>(
      `${this.baseUrl}/robots`
    );
  }

  getRobot(id: string): Observable<RobotMetadataDto> {
    return this.http.get<RobotMetadataDto>(
      `${this.baseUrl}/robots/${id}`
    );
  }

  /** @TODO Wire to backend GET /robots/:id/urdf when endpoint exists */
  downloadRobotUrdf(_id: string): Observable<Blob> {
    // TODO: replace with this.http.get(`${this.baseUrl}/robots/${id}/urdf`, { responseType: 'blob' })
    throw new Error('Not implemented — backend endpoint pending');
  }
}