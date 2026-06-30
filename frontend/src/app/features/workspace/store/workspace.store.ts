import { Injectable, inject, Signal, signal, computed } from '@angular/core';
import { WorkspaceApiService } from '../services/workspace-api.service';
import type { ActiveAnalysisResponse, ManipulabilityResponse, SingularityResponse, WorkspaceDto } from '../workspace-api.types';
import type {
  ColoredPoint, ManipulabilityData, SingularityData, SingularityMetrics,
  WorkspaceData, WorkspaceMetrics, WorkspaceBounds, WorkspaceState, WorkspaceUiState, ReachabilityResult,
} from '../workspace.types';

const INITIAL_UI: WorkspaceUiState = { loading: false, error: null };

const INITIAL_STATE: WorkspaceState = {
  data: null,
  pointCloud: null,
  showPointCloud: false,
  reachability: null,
  singularity: null,
  manipulability: null,
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

function toManipulabilityData(dto: ManipulabilityResponse): ManipulabilityData {
  const m = dto.metrics;
  const maxY = m.max_yoshikawa;
  const minY = m.min_yoshikawa;
  const range = maxY - minY || 1;

  const points: ManipulabilityData['points'] = dto.samples?.map(s => ({
    position: [s.position.x, s.position.y, s.position.z] as [number, number, number],
    yoshikawa: s.yoshikawa,
    normalized: (s.yoshikawa - minY) / range,
  })) ?? [];

  return {
    metrics: {
      totalSamples: m.total_samples,
      avgYoshikawa: m.avg_yoshikawa,
      minYoshikawa: m.min_yoshikawa,
      maxYoshikawa: m.max_yoshikawa,
      avgIsotropy: m.avg_isotropy,
      minIsotropy: m.min_isotropy,
      maxIsotropy: m.max_isotropy,
    },
    points,
  };
}

function toSingularityData(dto: SingularityResponse): SingularityData {
  const m = dto.metrics;
  const points: ColoredPoint[] = dto.samples?.map(s => ({
    position: [s.position.x, s.position.y, s.position.z] as [number, number, number],
    state: s.state as ColoredPoint['state'],
  })) ?? [];

  return {
    metrics: {
      totalSamples: m.total_samples,
      singularCount: m.singular_count,
      nearSingularCount: m.near_singular_count,
      normalCount: m.normal_count,
      avgConditionNumber: m.avg_condition_number,
    },
    points,
  };
}

@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly api = inject(WorkspaceApiService);

  // ── State signals ──

  private readonly dataSignal = signal<WorkspaceData | null>(null);
  private readonly pointCloudSignal = signal<[number, number, number][] | null>(null);
  private readonly showPointCloudSignal = signal(false);
  private readonly reachabilitySignal = signal<ReachabilityResult | null>(null);
  private readonly singularitySignal = signal<SingularityData | null>(null);
  private readonly manipulabilitySignal = signal<ManipulabilityData | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  /** Current workspace data (metrics + bounds). */
  readonly data: Signal<WorkspaceData | null> = this.dataSignal.asReadonly();

  /** Sampled point cloud positions, if available. */
  readonly pointCloud: Signal<[number, number, number][] | null> = this.pointCloudSignal.asReadonly();

  /** Whether the point cloud overlay is visible in the 3D viewer. */
  readonly showPointCloud: Signal<boolean> = this.showPointCloudSignal.asReadonly();

  /** Last reachability query result. */
  readonly reachability: Signal<ReachabilityResult | null> = this.reachabilitySignal.asReadonly();

  /** Singularity analysis data (metrics + colored point cloud). */
  readonly singularity: Signal<SingularityData | null> = this.singularitySignal.asReadonly();

  /** Manipulability analysis data (metrics + gradient points). */
  readonly manipulability: Signal<ManipulabilityData | null> = this.manipulabilitySignal.asReadonly();

  /** Loading state. */
  readonly loading: Signal<boolean> = this.loadingSignal.asReadonly();

  /** Error message, if any. */
  readonly error: Signal<string | null> = this.errorSignal.asReadonly();

  /** Derived: true when workspace has been sampled. */
  readonly hasData: Signal<boolean> = computed(() => this.dataSignal() !== null);

  // ── Actions ──

  /** Toggle point cloud visibility in the 3D viewer. */
  setShowPointCloud(v: boolean): void {
    this.showPointCloudSignal.set(v);
  }

  /** Sample a workspace for the given robot and config. */
  async sample(robotId: string, samples: number, seed: number, tolerance: number): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    this.reachabilitySignal.set(null);
    this.pointCloudSignal.set(null);
    this.showPointCloudSignal.set(false);

    try {
      const dto = await this.api.sample({
        robot_id: robotId,
        samples,
        seed,
        tolerance,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      this.dataSignal.set({
        metrics: toMetrics(dto.metrics),
        bounds: toBounds(dto.bounds),
      });

      // Extract point cloud from samples
      if (dto.samples && dto.samples.length > 0) {
        this.pointCloudSignal.set(
          dto.samples.map(s => [s.position.x, s.position.y, s.position.z] as [number, number, number]),
        );
      }
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

  /** Run manipulability analysis. Updates point cloud with green→red gradient. */
  async analyzeManipulability(robotId: string, samples: number, seed: number, tolerance: number): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const dto = await this.api.analyzeManipulability({
        robot_id: robotId,
        samples,
        seed,
        tolerance,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      const data = toManipulabilityData(dto);
      this.manipulabilitySignal.set(data);

      if (data.points.length > 0) {
        this.pointCloudSignal.set(data.points.map(p => p.position));
      }
      this.showPointCloudSignal.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Manipulability analysis failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Run singularity analysis on the current workspace data. */
  async analyzeSingularity(robotId: string, samples: number, seed: number, tolerance: number, threshold: number): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const dto = await this.api.analyzeSingularity({
        robot_id: robotId,
        samples,
        seed,
        tolerance,
        near_singular_condition_threshold: threshold,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      const data = toSingularityData(dto);
      this.singularitySignal.set(data);

      // Replace point cloud with colored version
      if (data.points.length > 0) {
        this.pointCloudSignal.set(data.points.map(p => p.position));
      }
      this.showPointCloudSignal.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Singularity analysis failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Sample workspace for the currently loaded robot (no robot_id needed). */
  async sampleActive(samples: number, seed: number, tolerance: number): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    this.reachabilitySignal.set(null);
    this.pointCloudSignal.set(null);
    this.showPointCloudSignal.set(false);

    try {
      const dto = await this.api.sampleActive({
        samples,
        seed,
        tolerance,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      this.dataSignal.set({
        metrics: toMetrics(dto.metrics),
        bounds: toBounds(dto.bounds),
      });

      if (dto.samples && dto.samples.length > 0) {
        this.pointCloudSignal.set(
          dto.samples.map(s => [s.position.x, s.position.y, s.position.z] as [number, number, number]),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sampling failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Full analysis (workspace + singularity + manipulability) on active robot. */
  async analyzeActive(
    samples: number,
    seed: number,
    tolerance: number,
    threshold: number,
  ): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const dto = await this.api.analyzeActive({
        samples,
        seed,
        tolerance,
        near_singular_condition_threshold: threshold,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      // Workspace
      this.dataSignal.set({
        metrics: toMetrics(dto.workspace),
        bounds: toBounds(dto.bounds),
      });

      // Singularity — includes colored point cloud (state colors)
      this.singularitySignal.set(toSingularityData({
        metrics: dto.singularity,
        samples: dto.singularity_samples,
      }));

      // Manipulability — includes gradient point cloud (yoshikawa gradient)
      // Takes priority over singularity in the viewer overlay (see scene-viewer.ts).
      this.manipulabilitySignal.set(toManipulabilityData({
        metrics: dto.manipulability,
        samples: dto.manipulability_samples,
      }));

      // Enable the overlay — the scene viewer picks the right source
      // based on priority: manipulability > singularity > monochrome.
      this.showPointCloudSignal.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Singularity analysis on the active (URDF) robot. */
  async analyzeActiveSingularity(
    samples: number,
    seed: number,
    tolerance: number,
    threshold: number,
  ): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    // Clear manipulability so the viewer overlay shows singularity
    this.manipulabilitySignal.set(null);

    try {
      const dto = await this.api.analyzeSingularityActive({
        samples,
        seed,
        tolerance,
        near_singular_condition_threshold: threshold,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      this.singularitySignal.set(toSingularityData(dto));

      // Show the colored point cloud
      if (dto.samples && dto.samples.length > 0) {
        this.showPointCloudSignal.set(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Singularity analysis failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Manipulability analysis on the active (URDF) robot. */
  async analyzeActiveManipulability(
    samples: number,
    seed: number,
    tolerance: number,
  ): Promise<void> {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    // Clear singularity so the viewer overlay shows manipulability
    this.singularitySignal.set(null);

    try {
      const dto = await this.api.analyzeManipulabilityActive({
        samples,
        seed,
        tolerance,
        include_samples: true,
      }).toPromise();

      if (!dto) throw new Error('Empty response');

      this.manipulabilitySignal.set(toManipulabilityData(dto));

      // Show the gradient point cloud
      if (dto.samples && dto.samples.length > 0) {
        this.showPointCloudSignal.set(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Manipulability analysis failed';
      this.errorSignal.set(msg);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /** Reset all state. */
  reset(): void {
    this.dataSignal.set(null);
    this.pointCloudSignal.set(null);
    this.showPointCloudSignal.set(false);
    this.reachabilitySignal.set(null);
    this.singularitySignal.set(null);
    this.manipulabilitySignal.set(null);
    this.loadingSignal.set(false);
    this.errorSignal.set(null);
  }
}
