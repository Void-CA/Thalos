import { describe, expect, it } from 'vitest'
import { apiClient, toApiError } from './api-client'
import { API_TIMEOUT_MS } from './constants'
import { ApiError, isCodedError } from './errors'

/**
 * Network error mapping (resilience-matrix-frontend spec, requirement
 * "Network Error Mapping"; error-ux spec "Additive Network Error Wrapping"):
 * network/timeout rejections are wrapped in coded ApiError objects AT THE
 * INTERCEPTOR, additive to the existing HTTP-body extraction. `isCodedError`
 * contract (R3-003) is untouched — the wrapped errors simply flow through it.
 */
describe('api-client — axios timeout configured from the shared constant', () => {
  it('sets the axios client timeout to API_TIMEOUT_MS', () => {
    expect(apiClient.defaults.timeout).toBe(API_TIMEOUT_MS)
  })
})

describe('toApiError — network/timeout wrapped in coded ApiError (additive)', () => {
  it('wraps a timeout rejection (ECONNABORTED) in ApiError{code: timeout_error}', () => {
    const err = toApiError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })
    expect(err).toBeInstanceOf(ApiError)
    const wrapped = err as ApiError
    expect(wrapped.message).toBe('Request timed out')
    expect(wrapped.code).toBe('timeout_error')
    expect(wrapped.status).toBeUndefined()
    expect(isCodedError(wrapped)).toBe(true)
  })

  it('wraps a network rejection (no response, request present) in ApiError{code: network_error}', () => {
    const err = toApiError({
      message: 'Network Error',
      request: {},
      response: undefined,
    })
    expect(err).toBeInstanceOf(ApiError)
    const wrapped = err as ApiError
    expect(wrapped.message).toBe('Backend is offline')
    expect(wrapped.code).toBe('network_error')
    expect(wrapped.status).toBeUndefined()
    expect(isCodedError(wrapped)).toBe(true)
  })

  it('passes HTTP error responses through unchanged — code extracted from the body', () => {
    const err = toApiError({
      message: 'Request failed with status code 404',
      response: { status: 404, data: { error: 'Robot missing', code: 'not_found' } },
    })
    expect(err).toBeInstanceOf(ApiError)
    const wrapped = err as ApiError
    expect(wrapped.code).toBe('not_found')
    expect(wrapped.status).toBe(404)
    expect(wrapped.message).toBe('Robot missing')
  })

  it('preserves non-coded errors without a network/timeout cause unchanged', () => {
    const err = toApiError(new Error('plain failure'))
    expect(err).toBeInstanceOf(ApiError)
    const wrapped = err as ApiError
    expect(wrapped.message).toBe('plain failure')
    expect(wrapped.code).toBeUndefined()
    expect(wrapped.status).toBeUndefined()
    // R3-003: a non-coded error is NOT coded.
    expect(isCodedError(wrapped)).toBe(false)
  })
})
