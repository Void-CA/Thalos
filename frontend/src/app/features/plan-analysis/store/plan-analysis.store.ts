import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PlanAnalysisApiService } from '../services/plan-analysis-api.service';
import type {
  AlternativesResponse,
  PlanAnalysisResponse,
  SummaryDto,
  MetricsDto,
  FindingDto,
  RecommendationDto,
  WaypointAnalysisDto,
  ProblemRegionDto,
} from '../plan-analysis-api.types';

export interface PlanAnalysisState {
  summary: SummaryDto | null;
  metrics: MetricsDto | null;
  waypoints: WaypointAnalysisDto[];
  findings: FindingDto[];
  recommendations: RecommendationDto[];
  problemRegions: ProblemRegionDto[];
  healthScore: number | null;
  loading: boolean;
  error: string | null;
}

const INITIAL: PlanAnalysisState = {
  summary: null,
  metrics: null,
  waypoints: [],
  findings: [],
  recommendations: [],
  problemRegions: [],
  healthScore: null,
  loading: false,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class PlanAnalysisStore {
  private readonly api = inject(PlanAnalysisApiService);

  // ── Analysis state ──

  readonly summary = signal<SummaryDto | null>(INITIAL.summary);
  readonly metrics = signal<MetricsDto | null>(INITIAL.metrics);
  readonly waypoints = signal<WaypointAnalysisDto[]>(INITIAL.waypoints);
  readonly findings = signal<FindingDto[]>(INITIAL.findings);
  readonly recommendations = signal<RecommendationDto[]>(INITIAL.recommendations);
  readonly problemRegions = signal<ProblemRegionDto[]>(INITIAL.problemRegions);
  readonly healthScore = signal<number | null>(INITIAL.healthScore);
  readonly loading = signal(INITIAL.loading);
  readonly error = signal<string | null>(INITIAL.error);

  /** Full reactive state snapshot. */
  readonly state = () => ({
    summary: this.summary(),
    metrics: this.metrics(),
    waypoints: this.waypoints(),
    findings: this.findings(),
    recommendations: this.recommendations(),
    problemRegions: this.problemRegions(),
    healthScore: this.healthScore(),
    loading: this.loading(),
    error: this.error(),
  });

  /** Has at least one analysis result loaded. */
  readonly hasResult = () =>
    this.summary() !== null || this.findings().length > 0;

  /** Analyze the currently active plan. */
  async analyzePlan(planId?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const res: PlanAnalysisResponse = await firstValueFrom(this.api.analyzePlan(planId));
      this.applyAnalysisResponse(res);
    } catch (err: unknown) {
      this.setError(err);
    } finally {
      this.loading.set(false);
    }
  }

  /** Reset analysis state. */
  reset(): void {
    this.summary.set(null);
    this.metrics.set(null);
    this.waypoints.set([]);
    this.findings.set([]);
    this.recommendations.set([]);
    this.problemRegions.set([]);
    this.healthScore.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.selectedRegionId.set(null);
    this.alternativesData.set(null);
    this.alternativesLoading.set(false);
    this.alternativesError.set(null);
  }

  private applyAnalysisResponse(res: PlanAnalysisResponse): void {
    this.summary.set(res.summary);
    this.metrics.set(res.metrics);
    this.waypoints.set(res.waypoints ?? []);
    this.findings.set(res.findings);
    this.recommendations.set(res.recommendations);
    this.problemRegions.set(res.problem_regions ?? []);
    this.healthScore.set(res.health_score ?? null);
  }

  private setError(err: unknown): void {
    let msg = 'Analysis failed';
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      msg = (typeof body === 'object' && body !== null)
        ? ((body as Record<string, unknown>)['error'] as string
          ?? (body as Record<string, unknown>)['message'] as string
          ?? `Server error (${err.status})`)
        : `Server error (${err.status})`;
    } else if (err instanceof Error) {
      msg = err.message;
    } else if (typeof err === 'string') {
      msg = err;
    }
    this.error.set(msg);
  }

  // ── Selected region (stub for slices 3-5) ──

  /** Región seleccionada en el panel contextual. Stub — habilitado en slices 3-5. */
  readonly selectedRegionId = signal<number | null>(null);

  /** Seleccionar una región para inspeccionar en el panel contextual. */
  selectRegion(id: number): void {
    this.selectedRegionId.set(id);
  }

  /** Limpiar la selección actual. */
  clearSelection(): void {
    this.selectedRegionId.set(null);
  }

  // ── Alternatives state ──

  readonly alternativesData = signal<AlternativesResponse | null>(null);
  readonly alternativesLoading = signal(false);
  readonly alternativesError = signal<string | null>(null);
  readonly selectedAlternativeRank = signal<number | null>(null);

  /** Generate alternatives for the active plan. */
  async generateAlternatives(sessionId?: number): Promise<void> {
    this.alternativesLoading.set(true);
    this.alternativesError.set(null);
    this.alternativesData.set(null);

    try {
      const res = sessionId != null
        ? await firstValueFrom(this.api.regenerateFromExecution(sessionId))
        : await firstValueFrom(this.api.generateAlternatives());
      this.alternativesData.set(res);
    } catch (err: unknown) {
      let msg = 'Alternatives generation failed';
      if (err instanceof HttpErrorResponse) {
        const body = err.error;
        msg = (typeof body === 'object' && body !== null)
          ? ((body as Record<string, unknown>)['error'] as string
            ?? (body as Record<string, unknown>)['message'] as string
            ?? `Server error (${err.status})`)
          : `Server error (${err.status})`;
      } else if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'string') {
        msg = err;
      }
      this.alternativesError.set(msg);
    } finally {
      this.alternativesLoading.set(false);
    }
  }
}
