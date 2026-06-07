// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/workspace/dto.rs

export interface SampleRequest {
    robot_id: string;
    samples?: number;
    seed?: number;
    tolerance?: number;
    include_samples?: boolean;
}

export interface PointDto {
    x: number;
    y: number;
    z: number;
}

export interface BoundingBoxDto {
    min: PointDto;
    max: PointDto;
}

export interface WorkspaceMetricsDto {
    bounding_volume: number;
    max_reach: number;
    min_reach: number;
    centroid: PointDto;
    sample_count: number;
}

export interface WorkspaceSampleDto {
    q: number[];
    position: PointDto;
}

export interface WorkspaceDto {
    metrics: WorkspaceMetricsDto;
    bounds: BoundingBoxDto;
    samples?: WorkspaceSampleDto[];
}

export interface ReachabilityRequest {
    point: PointDto;
    tolerance: number;
}

export interface ReachabilityDto {
    reachable: boolean;
    nearest_distance: number;
}

export interface ErrorResponse {
    error: string;
    code: string;
}
