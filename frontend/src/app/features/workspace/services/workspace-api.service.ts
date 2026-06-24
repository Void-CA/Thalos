import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ActiveAnalysisRequest, ActiveAnalysisResponse,
  ActiveSampleRequest,
  BoundingBoxDto,
  ManipulabilityRequest, ManipulabilityResponse,
  WorkspaceDto, ReachabilityDto, SampleRequest, ReachabilityRequest,
  SingularityRequest, SingularityResponse,
} from '../workspace-api.types';
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

  analyzeSingularity(req: SingularityRequest): Observable<SingularityResponse> {
    return this.http.post<SingularityResponse>(`${this.baseUrl}/workspace/singularity`, req);
  }

  analyzeManipulability(req: ManipulabilityRequest): Observable<ManipulabilityResponse> {
    return this.http.post<ManipulabilityResponse>(`${this.baseUrl}/workspace/manipulability`, req);
  }

  // ── Active-robot endpoints ──

  /** Sample workspace for the currently loaded robot. */
  sampleActive(req: ActiveSampleRequest): Observable<WorkspaceDto> {
    return this.http.post<WorkspaceDto>(`${this.baseUrl}/workspace/sample/active`, req);
  }

  /** Get workspace bounds for the currently loaded robot. */
  boundsActive(req: ActiveSampleRequest): Observable<BoundingBoxDto> {
    return this.http.post<BoundingBoxDto>(`${this.baseUrl}/workspace/bounds/active`, req);
  }

  /** Full analysis (workspace + singularity + manipulability) for active robot. */
  analyzeActive(req: ActiveAnalysisRequest): Observable<ActiveAnalysisResponse> {
    return this.http.post<ActiveAnalysisResponse>(`${this.baseUrl}/workspace/analyze/active`, req);
  }
}
