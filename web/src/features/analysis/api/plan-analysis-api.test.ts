import { describe, it, expect, vi, beforeEach } from 'vitest'
import { planAnalysisApi } from './plan-analysis-api'
import type { ProgramEditWire } from '@/shared/contracts/program-edit'

/**
 * CDD step 3 — POST /plan/program/edit. Pins `editProgram` to its exact route
 * and request body: the raw `ProgramEdit` (semantic command language) wrapped
 * in `{ edit }` — the free-form counterpart of `apply(recommendationId)`, with
 * NO recommendation_id and NO parallel HTTP command format.
 */

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { post: apiMocks.post },
}))

const edit: ProgramEditWire = {
  MoveWaypoint: { segment_index: 0, new_target: [0.55, -0.3, -0.1, 0.0], old_target: [0.5, -0.3, -0.1, 0.0] },
}

const applyResponse = {
  recommendation_id: 0,
  plan_id: 'plan-2',
  health_before: 0.5,
  health_after: 0.62,
  improvement: 0.12,
  history_length: 1,
}

beforeEach(() => {
  apiMocks.post.mockReset()
  apiMocks.post.mockResolvedValue({ data: applyResponse })
})

describe('planAnalysisApi.editProgram', () => {
  it('POSTs the raw ProgramEdit to /plan/program/edit wrapped in { edit }', async () => {
    await planAnalysisApi.editProgram(edit)

    expect(apiMocks.post).toHaveBeenCalledTimes(1)
    const [route, body] = apiMocks.post.mock.calls[0]
    expect(route).toBe('/plan/program/edit')
    expect(body).toEqual({ edit })
    // No recommendation_id leaks into the free-form path.
    expect(Object.keys(body)).toEqual(['edit'])
  })

  it('returns the ApplyResponse payload (r.data) — health before/after, plan_id, history', async () => {
    await expect(planAnalysisApi.editProgram(edit)).resolves.toEqual(applyResponse)
  })
})
