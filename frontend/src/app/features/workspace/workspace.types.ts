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

export interface WorkspaceUiState {
    loading: boolean;
    error: string | null;
}

export interface WorkspaceState {
    data: WorkspaceData | null;
    reachability: ReachabilityResult | null;
    ui: WorkspaceUiState;
}
