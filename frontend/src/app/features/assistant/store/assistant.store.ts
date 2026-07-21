import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AssistantApiService } from '../services/assistant-api.service';
import type {
  ExplainEntryDto, OptimizationObjectiveDto, ParetoSolutionDto,
  LearnedPatternDto, ExecutionInsightDto, AdaptationEventDto,
} from '../assistant-api.types';

@Injectable({ providedIn: 'root' })
export class AssistantStore {
  private readonly api = inject(AssistantApiService);

  readonly explainEntries = signal<ExplainEntryDto[]>([]);
  readonly optimizationObjectives = signal<OptimizationObjectiveDto[]>([]);
  readonly paretoFront = signal<ParetoSolutionDto[]>([]);
  readonly optIterations = signal(0);
  readonly optConverged = signal(false);
  readonly learnedPatterns = signal<LearnedPatternDto[]>([]);
  readonly executionInsights = signal<ExecutionInsightDto[]>([]);
  readonly adaptationEvents = signal<AdaptationEventDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly hasExplain = () => this.explainEntries().length > 0;
  readonly hasAdaptationAlerts = () => this.adaptationEvents().filter(e => e.status === 'pending' || e.status === 'active').length > 0;

  private setError(err: unknown): void {
    let msg = 'Operation failed';
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

  async explainPlan(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.api.explainPlan());
      this.explainEntries.set(res.entries);
    } catch (err: unknown) {
      this.setError(err);
    } finally {
      this.loading.set(false);
    }
  }

  async runOptimization(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const objectives = this.optimizationObjectives().map(o => ({
        id: o.id, weight: o.weight, enabled: o.enabled,
      }));
      const res = await firstValueFrom(this.api.runOptimization({ objectives }));
      this.optimizationObjectives.set(res.objectives);
      this.paretoFront.set(res.pareto_front);
      this.optIterations.set(res.iterations);
      this.optConverged.set(res.converged);
    } catch (err: unknown) {
      this.setError(err);
    } finally {
      this.loading.set(false);
    }
  }

  updateWeight(id: string, weight: number): void {
    this.optimizationObjectives.update(list =>
      list.map(o => o.id === id ? { ...o, weight } : o),
    );
  }

  toggleObjective(id: string): void {
    this.optimizationObjectives.update(list =>
      list.map(o => o.id === id ? { ...o, enabled: !o.enabled } : o),
    );
  }

  async refreshLearn(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.api.learnPatterns());
      this.learnedPatterns.set(res.patterns);
      this.executionInsights.set(res.insights);
    } catch (err: unknown) {
      this.setError(err);
    } finally {
      this.loading.set(false);
    }
  }

  async refreshAdapt(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.api.listAdaptations());
      this.adaptationEvents.set(res.events);
    } catch (err: unknown) {
      this.setError(err);
    } finally {
      this.loading.set(false);
    }
  }

  async resolveAdaptation(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.resolveAdaptation(id));
      this.adaptationEvents.update(events =>
        events.map(e => e.id === id ? { ...e, status: 'completed' as const } : e),
      );
    } catch (err: unknown) {
      this.setError(err);
    } finally {
      this.loading.set(false);
    }
  }

  reset(): void {
    this.explainEntries.set([]);
    this.optimizationObjectives.set([]);
    this.paretoFront.set([]);
    this.optIterations.set(0);
    this.optConverged.set(false);
    this.learnedPatterns.set([]);
    this.executionInsights.set([]);
    this.adaptationEvents.set([]);
    this.loading.set(false);
    this.error.set(null);
  }
}
