import type { DurationDto, CompileMetadata, ExecutionProgram } from '@/shared/contracts'

/** A single semantic operation as sent to the API */
export interface SemanticOp {
  type: 'pick' | 'place' | 'move_to' | 'wait' | 'home'
  origin?: string
  object?: string
  destination?: string
  tool?: string
  /** Wait duration — wire format `{secs, nanos}` (DurationDto), never a float */
  duration?: DurationDto
}

/** Pose definition for a resource */
export interface PoseDef {
  position: [number, number, number]
  orientation: [number, number, number, number]
}

/** A resource with an associated pose (for the Scene) */
export interface SceneResourceDef {
  id: string
  name: string
  pose: PoseDef
  category?: string | null
  description?: string | null
}

/** SceneContent — the scene within a TaskDocument */
export interface SceneContent {
  objects: SceneResourceDef[]
  locations: SceneResourceDef[]
  tools: { id: string; name: string }[]
  home_pose: PoseDef
}

/** Metadata for a TaskDocument */
export interface DocMetadata {
  name: string
  version: number
  created_at: string
  modified_at: string
}

/** TaskDocument — unified scene + program */
export interface TaskDocument {
  id: string
  metadata: DocMetadata
  scene: SceneContent
  program: { operations: SemanticOp[] }
}

/** Request body wrapping a TaskDocument */
export interface CompileRequest {
  task: TaskDocument
}

/** Response from compile — `motion_program` carries the ExecutionProgram (IR-1) produced by SemanticLowering */
export interface CompileResponse {
  status: string
  validation: { errors: string[]; warnings: string[] }
  metadata: CompileMetadata
  motion_program: ExecutionProgram
}


