import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type { AlternativesResponse, PlanAnalysisResponse, RepairOptionsResponse } from '../plan-analysis-api.types';

@Injectable({ providedIn: 'root' })
export class PlanAnalysisApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Analyze the currently active plan. */
  analyzePlan(planId?: string): Observable<PlanAnalysisResponse> {
    return this.http.post<PlanAnalysisResponse>(
      `${this.baseUrl}/plan/analyze`,
      { plan_id: planId ?? null },
    );
  }

  /** Generate alternative plans for the active plan. */
  generateAlternatives(): Observable<AlternativesResponse> {
    return this.http.post<AlternativesResponse>(
      `${this.baseUrl}/plan/analyze/alternatives`,
      {},
    );
  }

  /** Get repair options for the active plan (M8.2.3). */
  getRepairOptions(): Observable<RepairOptionsResponse> {
    return this.http.post<RepairOptionsResponse>(
      `${this.baseUrl}/plan/repair/options`,
      {},
    );
  }

  /** Regenerate alternatives from execution evidence. */
  regenerateFromExecution(sessionId: number): Observable<AlternativesResponse> {
    return this.http.post<AlternativesResponse>(
      `${this.baseUrl}/plan/regenerate-from-execution/${sessionId}`,
      {},
    );
  }
}
