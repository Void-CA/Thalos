import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type { AlternativesResponse, PlanAnalysisResponse, RepairOptionsResponse } from '../plan-analysis-api.types';
import type { CreateSessionResponse, PreviewRequest, PreviewResponse, ApplyRequest, ApplyResponse } from '../repair-session.types';

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

  /** Create a repair session (M8.4). */
  createSession(): Observable<CreateSessionResponse> {
    return this.http.post<CreateSessionResponse>(
      `${this.baseUrl}/repair/sessions`,
      {},
    );
  }

  /** Preview a strategy for a session (M8.4). */
  previewRepair(sessionId: number, req: PreviewRequest): Observable<PreviewResponse> {
    return this.http.post<PreviewResponse>(
      `${this.baseUrl}/repair/sessions/${sessionId}/preview`,
      req,
    );
  }

  /** Apply a repair (M8.4). */
  applyRepair(sessionId: number, req: ApplyRequest): Observable<ApplyResponse> {
    return this.http.post<ApplyResponse>(
      `${this.baseUrl}/repair/sessions/${sessionId}/apply`,
      req,
    );
  }

  /** Undo last repair (M8.4.3). */
  undoRepair(sessionId: number): Observable<ApplyResponse> {
    return this.http.post<ApplyResponse>(
      `${this.baseUrl}/repair/sessions/${sessionId}/undo`,
      {},
    );
  }

  /** Delete a session (M8.4). */
  deleteSession(sessionId: number): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/repair/sessions/${sessionId}`,
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
