import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type {
  ExplainResponse, OptimizeRequest, OptimizeResponse,
  LearnResponse, AdaptResponse, AdaptResolveRequest,
} from '../assistant-api.types';

@Injectable({ providedIn: 'root' })
export class AssistantApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  explainPlan(): Observable<ExplainResponse> {
    return this.http.post<ExplainResponse>(`${this.baseUrl}/plan/explain`, {});
  }

  runOptimization(request: OptimizeRequest): Observable<OptimizeResponse> {
    return this.http.post<OptimizeResponse>(`${this.baseUrl}/plan/optimize`, request);
  }

  learnPatterns(): Observable<LearnResponse> {
    return this.http.post<LearnResponse>(`${this.baseUrl}/plan/learn`, {});
  }

  listAdaptations(): Observable<AdaptResponse> {
    return this.http.post<AdaptResponse>(`${this.baseUrl}/plan/adapt`, {});
  }

  resolveAdaptation(id: string): Observable<void> {
    const body: AdaptResolveRequest = { id };
    return this.http.post<void>(`${this.baseUrl}/plan/adapt/resolve`, body);
  }
}
