/** A single semantic operation as sent to the API */
export interface SemanticOp {
  type: 'pick' | 'place' | 'move_to' | 'wait' | 'home'
  object?: string
  destination?: string
  tool?: string
  duration_secs?: number
}

/** Pose definition for a resource */
export interface PoseDef {
  position: [number, number, number]
  orientation: [number, number, number, number]
}

/** A resource with an associated pose */
export interface ResourcePose {
  id: string
  pose: PoseDef
}

/** Request body for POST /api/v1/semantic/compile */
export interface CompileRequest {
  operations: SemanticOp[]
  objects?: ResourcePose[]
  locations?: ResourcePose[]
  home_pose?: PoseDef
}

/** Response from a successful compile */
export interface CompileResponse {
  status: string
  execution_plan: {
    segment_count: number
    duration_ms: number
  }
  validation: {
    errors: string[]
    warnings: string[]
  }
  metadata: {
    instruction_count: number
    planning_time_ms: number
  }
}
