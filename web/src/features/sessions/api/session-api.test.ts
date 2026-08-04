import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sessionApi } from './session-api'

/**
 * S5.4 — canonical session endpoint surface (session-browser spec, invariant
 * I4: "Canonical endpoints only"). Pins every browser method to its exact
 * `GET /sessions...` route so no parallel client model can creep in: the api
 * module is the single canonical session data source for the UI.
 */

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { get: apiMocks.get },
}))

beforeEach(() => {
  apiMocks.get.mockReset()
  apiMocks.get.mockResolvedValue({ data: {} })
})

describe('sessionApi — canonical session endpoints (I4)', () => {
  it('maps every browser method to its canonical GET /sessions endpoint', async () => {
    await sessionApi.list()
    await sessionApi.get(1)
    await sessionApi.summary(1)
    await sessionApi.statistics(1)
    await sessionApi.trace(1)
    await sessionApi.comparison(1)
    await sessionApi.executionTrace(1)
    await sessionApi.exportCsv(1)

    const urls = apiMocks.get.mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      '/sessions',
      '/sessions/1',
      '/sessions/1/summary',
      '/sessions/1/statistics',
      '/sessions/1/trace',
      '/sessions/1/comparison',
      '/sessions/1/execution-trace',
      '/sessions/1/export',
    ])
  })

  it('returns the endpoint payload (r.data) — no client-side reshaping', async () => {
    const summary = { session_id: 1, sample_count: 42 }
    apiMocks.get.mockResolvedValue({ data: summary })
    await expect(sessionApi.summary(1)).resolves.toEqual(summary)
  })
})
