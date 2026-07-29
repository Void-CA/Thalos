import axios from 'axios'
import type { CompileRequest, CompileResponse } from './types'

const client = axios.create({ baseURL: '/api/v1' })

/** POST /api/v1/semantic/compile — compile a semantic task program */
export async function compileSemantic(
  req: CompileRequest,
): Promise<CompileResponse> {
  const { data } = await client.post<CompileResponse>('/semantic/compile', req)
  return data
}
