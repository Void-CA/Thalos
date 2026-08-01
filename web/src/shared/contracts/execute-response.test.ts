import { describe, expect, it } from 'vitest'
import type { ExecuteSemanticResponse } from '@/shared/contracts'

// Backend `POST /semantic/execute` response literal (semantic handler): the 5
// fields the handler emits — status, segment_count, duration_secs (backend
// execution total, NOT the wait-op serialization), waypoints, event_count.
const fixture = {
  status: 'ok',
  segment_count: 3,
  duration_secs: 4.5,
  waypoints: [
    { joints: [0.0, 0.0, 0.0] },
    { joints: [0.5, 1.0, 0.0] },
    { joints: [1.0, 1.0, 0.5] },
  ],
  event_count: 2,
} satisfies ExecuteSemanticResponse

const WIRE = JSON.stringify(fixture)

/** Decode the wire JSON against the contract type (pure type-level decode). */
function decode(raw: string): ExecuteSemanticResponse {
  return JSON.parse(raw) as ExecuteSemanticResponse
}

describe('ExecuteSemanticResponse', () => {
  it('decodes the backend execute fixture with all 5 fields', () => {
    const res = decode(WIRE)
    expect(res.status).toBe('ok')
    expect(res.segment_count).toBe(3)
    expect(res.duration_secs).toBe(4.5)
    expect(res.waypoints).toHaveLength(3)
    expect(res.event_count).toBe(2)
  })

  it('preserves field types after decode', () => {
    const res = decode(WIRE)
    expect(typeof res.status).toBe('string')
    expect(typeof res.segment_count).toBe('number')
    expect(typeof res.duration_secs).toBe('number')
    expect(Array.isArray(res.waypoints)).toBe(true)
    expect(typeof res.event_count).toBe('number')
  })

  it('keeps duration_secs as the backend-computed float total', () => {
    const res = decode(WIRE)
    expect(res.duration_secs).toBeGreaterThan(0)
    expect(Number.isFinite(res.duration_secs)).toBe(true)
  })
})
