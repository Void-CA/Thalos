import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PlanAnalysisApiService } from '../services/plan-analysis-api.service';
import type {
  PlanAnalysisResponse,
  SummaryDto,
  MetricsDto,
  FindingDto,
  RecommendationDto,
} from '../plan-analysis-api.types';

export interface PlanAnalysisState {
  summary: SummaryDto | null;
  metrics: MetricsDto | null;
  findings: FindingDto[];
  recommendations: RecommendationDto[];
  loading: boolean;
  error: string | null;
}

const INITIAL: PlanAnalysisState = {
  summary: null,
  metrics: null,
  findings: [],
  recommendations: [],
  loading: false,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class PlanAnalysisStore {
  private readonly api = inject(PlanAnalysisApiService);

  readonly summary = signal<SummaryDto | null>(INITIAL.summary);
  readonly metrics = signal<MetricsDto | null>(INITIAL.metrics);
  readonly findings = signal<FindingDto[]>(INITIAL.findings);
  readonly recommendations = signal<RecommendationDto[]>(INITIAL.recommendations);
  readonly loading = signal(INITIAL.loading);
  readonly error = signal<string | null>(INITIAL.error);

  /** Full reactive state snapshot. */
  readonly state = () => ({
    summary: this.summary(),
    metrics: this.metrics(),
    findings: this.findings(),
    recommendations: this.recommendations(),
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
      this.applyResponse(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  /** Reset analysis state. */
  reset(): void {
    this.summary.set(null);
    this.metrics.set(null);
    this.findings.set([]);
    this.recommendations.set([]);
    this.loading.set(false);
    this.error.set(null);
  }

  private applyResponse(res: PlanAnalysisResponse): void {
    this.summary.set(res.summary);
    this.metrics.set(res.metrics);
    this.findings.set(res.findings);
    this.recommendations.set(res.recommendations);
  }
}
