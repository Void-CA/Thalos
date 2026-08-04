import type { CompileMetadata, ExecutionProgram, TaskDocument } from '@/shared/contracts'

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
