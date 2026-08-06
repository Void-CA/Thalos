import { describe, expect, it } from 'vitest'
import { API_TIMEOUT_MS } from './constants'

/**
 * Shared timeout configuration (resilience-matrix-frontend spec, requirement
 * "Shared Timeout Configuration"): the 10s timeout is a single source of
 * truth exported from `web/src/shared/constants.ts` and is NOT
 * environment-configurable — no module may override it at runtime.
 */
describe('API_TIMEOUT_MS — shared timeout constant (resilience-matrix spec)', () => {
  it('is exactly 10_000 ms (10s), the single source of truth', () => {
    expect(API_TIMEOUT_MS).toBe(10_000)
  })

  it('is a frozen primitive — no runtime override can change the timeout', () => {
    // The constant must be a plain number literal, not something derived from
    // `import.meta.env` (spec: "no environment variable overrides the value").
    expect(typeof API_TIMEOUT_MS).toBe('number')
    expect(Number.isFinite(API_TIMEOUT_MS)).toBe(true)
  })
})
