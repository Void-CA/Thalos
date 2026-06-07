import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { WorkspaceDto, ReachabilityDto, SampleRequest, ReachabilityRequest } from '../workspace-api.types';
import { API_BASE_URL } from '../../../shared/api/api-config';

@Injectable({ providedIn: 'root' })
export class WorkspaceApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  sample(req: SampleRequest): Observable<WorkspaceDto> {
    return this.http.post<WorkspaceDto>(`${this.baseUrl}/workspace/sample`, req);
  }

  checkReachability(req: ReachabilityRequest): Observable<ReachabilityDto> {
    return this.http.post<ReachabilityDto>(`${this.baseUrl}/workspace/reachability`, req);
  }
}
