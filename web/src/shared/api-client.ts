import axios from 'axios'
import { ApiError } from './errors'
import { API_TIMEOUT_MS } from './constants'

/** Single API base for the whole app: relative `/api/v1` in dev (Vite proxy
 *  forwards `/api` to the backend) and in same-origin production; override
 *  with `VITE_API_BASE` for an absolute backend URL. Never a hardcoded host. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE ?? '/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
})

/** Normalize any axios rejection into the app error contract.
 *
 *  Pure (unit-testable without a live client): the response interceptor
 *  delegates here so the error-wrapping rules are covered by direct tests.
 *
 *  Additive wrapping (resilience-matrix-frontend spec, "Network Error
 *  Mapping"; error-ux spec, "Additive Network Error Wrapping"): network and
 *  timeout rejections are wrapped in coded `ApiError`s — `isCodedError`
 *  (R3-003) is untouched and the new codes flow through `describeError` →
 *  `CTA_BY_CODE`. HTTP error responses keep the existing body extraction.
 */
export function toApiError(error: unknown): unknown {
  const candidate = error as {
    code?: string
    response?: unknown
    request?: unknown
    message?: string
  }

  // Timeout: axios rejects with `code === 'ECONNABORTED'` when the configured
  // timeout fires — before any HTTP response exists.
  if (candidate?.code === 'ECONNABORTED') {
    return new ApiError('Request timed out', {
      code: 'timeout_error',
      cause: error instanceof Error ? error : undefined,
    })
  }

  // Network failure: an axios error with a request but NO response (DNS
  // failure, connection refused, backend offline).
  if (candidate?.response == null && candidate?.request != null) {
    return new ApiError('Backend is offline', {
      code: 'network_error',
      cause: error instanceof Error ? error : undefined,
    })
  }

  // HTTP error responses (and non-axios errors) — existing extraction path.
  const data = candidate?.response
    ? (candidate.response as { data?: unknown }).data
    : undefined
  const record =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : undefined
  const message =
    (typeof record?.error === 'string' ? record.error : undefined) ??
    (typeof record?.message === 'string' ? record.message : undefined) ??
    candidate?.message ??
    'Request failed'
  // Preserve the raw body as `details` only when it carries fields beyond
  // the standard `error`/`code` pair (e.g. validation specifics).
  const hasExtraFields = record
    ? Object.keys(record).some(key => key !== 'error' && key !== 'code')
    : false
  return new ApiError(message, {
    status:
      candidate?.response && typeof candidate.response === 'object'
        ? ((candidate.response as { status?: number }).status)
        : undefined,
    code: typeof record?.code === 'string' ? record.code : undefined,
    details: hasExtraFields ? record : undefined,
    cause: error instanceof Error ? error : undefined,
  })
}

apiClient.interceptors.response.use(
  response => response,
  error => Promise.reject(toApiError(error)),
)
