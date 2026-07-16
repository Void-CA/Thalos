import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type { PlanAnalysisResponse } from '../plan-analysis-api.types';

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
}
