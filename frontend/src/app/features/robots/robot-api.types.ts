// ── Mirror de DTOs backend ──
// Fuente de verdad: backend/crates/thalos-api/src/features/robots/dto.rs

export interface RobotMetadataDto {
  id: string;
  display_name: string;
  dof: number;
  joints: JointMetadataDto[];
}

export interface JointMetadataDto {
  name: string;
  kind: string;
  min: number | null;
  max: number | null;
}
