import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { RobotMetadataDto } from '../robot-api.types';

@Injectable({ providedIn: 'root' })
export class RobotApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/api/v1';

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
}