import axios from 'axios'
import { ApiError } from './errors'

/** Single API base for the whole app: relative `/api/v1` in dev (Vite proxy
 *  forwards `/api` to the backend) and in same-origin production; override
 *  with `VITE_API_BASE` for an absolute backend URL. Never a hardcoded host. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE ?? '/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.response.use(
  response => response,
  error => {
    const data = error.response?.data
    const record =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : undefined
    const message =
      (typeof record?.error === 'string' ? record.error : undefined) ??
      (typeof record?.message === 'string' ? record.message : undefined) ??
      error.message ??
      'Request failed'
    // Preserve the raw body as `details` only when it carries fields beyond
    // the standard `error`/`code` pair (e.g. validation specifics).
    const hasExtraFields = record
      ? Object.keys(record).some(key => key !== 'error' && key !== 'code')
      : false
    return Promise.reject(
      new ApiError(message, {
        status: error.response?.status,
        code: typeof record?.code === 'string' ? record.code : undefined,
        details: hasExtraFields ? record : undefined,
        cause: error instanceof Error ? error : undefined,
      }),
    )
  },
)
