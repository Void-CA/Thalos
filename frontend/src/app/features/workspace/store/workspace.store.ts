import { Injectable, inject, Signal, signal, computed } from '@angular/core';
import { WorkspaceApiService } from '../services/workspace-api.service';
import type { WorkspaceDto } from '../workspace-api.types';
import type { WorkspaceData, WorkspaceMetrics, WorkspaceBounds, WorkspaceState, WorkspaceUiState, ReachabilityResult } from '../workspace.types';

const INITIAL_UI: WorkspaceUiState = { loading: false, error: null };

const INITIAL_STATE: WorkspaceState = {
  data: null,
  reachability: null,
  ui: INITIAL_UI,
};

function toMetrics(dto: WorkspaceDto['metrics']): WorkspaceMetrics {
  return {
    boundingVolume: dto.bounding_volume,
    maxReach: dto.max_reach,
    minReach: dto.min_reach,
    centroid: [dto.centroid.x, dto.centroid.y, dto.centroid.z],
    sampleCount: dto.sample_count,
  };
}

function toBounds(dto: WorkspaceDto['bounds']): WorkspaceBounds {
  return {
    min: [dto.min.x, dto.min.y, dto.min.z],
    max: [dto.max.x, dto.max.y, dto.max.z],
  };
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly api = inject(WorkspaceApiService);

  // ── State signals ──

  private readonly dataSignal = signal<WorkspaceData | null>(null);
  private readonly reachabilitySignal = signal<ReachabilityResult | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  /** Current workspace data (metrics + bounds). */
  readonly data: Signal<WorkspaceData | null> = this.dataSignal.asReadonly();

  /** Last reachability query result. */
  readonly reachability: Signal<ReachabilityResult | null> = this.reachabilitySignal.asReadonly();

  /** Loading state. */
  readonly loading: Signal<boolean> = this.loadingSignal.asReadonly();

  /** Error message, if any. */
  readonly error: Signal<string | null> = this.errorSignal.asReadonly();

  /** Derived: true when workspace has been sampled. */
  readonly hasData: Signal<boolean> = computed(() => this.dataSignal() !== null);

  // ── Actions ──

  /** Sample a workspace for the given robot and config. */
  async sample(robotId: string, samples: number, seed: number, tolerance: number): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    this.reachabilitySignal.set(null);

    try {
      const dto = await this.api.sample({
        robot_id: robotId,
        samples,
        seed,
        tolerance,
        include_samples: false,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      this.dataSignal.set({
        metrics: toMetrics(dto.metrics),
        bounds: toBounds(dto.bounds),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sampling failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Check reachability of a point against the current workspace. */
  async checkReachability(point: [number, number, number], tolerance: number): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const dto = await this.api.checkReachability({
        point: { x: point[0], y: point[1], z: point[2] },
        tolerance,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      this.reachabilitySignal.set({
        reachable: dto.reachable,
        nearestDistance: dto.nearest_distance,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reachability check failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Reset all state. */
  reset(): void {
    this.dataSignal.set(null);
    this.reachabilitySignal.set(null);
    this.loadingSignal.set(false);
    this.errorSignal.set(null);
  }
}
