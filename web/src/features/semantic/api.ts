import axios from 'axios'
import type { CompileRequest, CompileResponse } from './types'

const client = axios.create({ baseURL: '/api/v1' })

export class CompileError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'CompileError'
  }
}

/** POST /api/v1/semantic/execute — compile + plan, returns plan metadata */
export async function executeSemantic(req: CompileRequest): Promise<{ segment_count: number; duration_secs: number }> {
  const { data } = await client.post('/semantic/execute', req)
  return data
}

/** POST /api/v1/semantic/compile — compile a semantic task program */
export async function compileSemantic(
  req: CompileRequest,
): Promise<CompileResponse> {
  try {
    const { data } = await client.post<CompileResponse>('/semantic/compile', req)
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      const body = err.response.data as Record<string, unknown>
      throw new CompileError(
        (body.error as string) ?? err.message,
        body.code as string,
        err.response.status,
      )
    }
    throw new CompileError(
      err instanceof Error ? err.message : 'Compilation failed',
    )
  }
}
