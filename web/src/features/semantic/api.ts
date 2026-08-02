import { apiClient } from '@/shared/api-client'
import { isApiError } from '@/shared/errors'
import type { CompileRequest, CompileResponse } from './types'
import type { ExecuteSemanticResponse } from '@/shared/contracts'

export class CompileError extends Error {
  readonly code?: string
  readonly status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'CompileError'
    this.code = code
    this.status = status
  }
}

/** POST /api/v1/semantic/execute — compile + plan, returns plan metadata */
export async function executeSemantic(req: CompileRequest): Promise<ExecuteSemanticResponse> {
  const { data } = await apiClient.post('/semantic/execute', req)
  return data
}

/** POST /api/v1/semantic/compile — compile a semantic task program */
export async function compileSemantic(
  req: CompileRequest,
): Promise<CompileResponse> {
  try {
    const { data } = await apiClient.post<CompileResponse>('/semantic/compile', req)
    return data
  } catch (err) {
    if (isApiError(err)) {
      throw new CompileError(err.message, err.code, err.status)
    }
    throw new CompileError(
      err instanceof Error ? err.message : 'Compilation failed',
    )
  }
}
