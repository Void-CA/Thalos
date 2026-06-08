// ── Internal frontend types for workspace state ──

export interface WorkspaceMetrics {
    boundingVolume: number;
    maxReach: number;
    minReach: number;
    centroid: [number, number, number];
    sampleCount: number;
}

export interface WorkspaceBounds {
    min: [number, number, number];
    max: [number, number, number];
}

export interface WorkspaceData {
    metrics: WorkspaceMetrics;
    bounds: WorkspaceBounds;
}

export interface ReachabilityResult {
    reachable: boolean;
    nearestDistance: number;
}

export type SingularityStateLabel = 'normal' | 'near_singular' | 'singular';

export interface ColoredPoint {
    position: [number, number, number];
    state: SingularityStateLabel;
}

export interface SingularityMetrics {
    totalSamples: number;
    singularCount: number;
    nearSingularCount: number;
    normalCount: number;
    avgConditionNumber: number;
}

export interface SingularityData {
    metrics: SingularityMetrics;
    points: ColoredPoint[];
}

export interface WorkspaceUiState {
    loading: boolean;
    error: string | null;
}

export interface WorkspaceState {
    data: WorkspaceData | null;
    pointCloud: [number, number, number][] | null;
    showPointCloud: boolean;
    reachability: ReachabilityResult | null;
    singularity: SingularityData | null;
    ui: WorkspaceUiState;
}
