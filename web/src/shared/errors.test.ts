import { describe, expect, it } from 'vitest'
import { ApiError, describeError, CTA_BY_CODE, ctaLabelForCode } from './errors'

/**
 * describeError contract (error-ux spec, requirement "Centralized describeError
 * Mapper"): maps ApiError codes to actionable CTA strings, keying on `code`
 * first with HTTP `status` complementary only.
 *
 * Spec scenarios pinned here:
 * - Known code maps to CTA (`no_active_plan`)
 * - Unknown code falls back to `message (code)`
 * - Non-ApiError falls back to `message`
 */
describe('describeError — known code maps to CTA (error-ux spec)', () => {
  it('maps no_active_plan to the actionable planning CTA, keeping the backend message', () => {
    const err = new ApiError('No plan', { code: 'no_active_plan', status: 412 })
    expect(describeError(err)).toBe(
      'Preview a motion program in Programming first — No plan',
    )
  })

  it('keeps the other lifted CTAs intact for semantic compile errors', () => {
    expect(CTA_BY_CODE.semantic_validation_error).toBe('Fix the program errors')
    expect(CTA_BY_CODE.lowering_error).toBe(
      "Define the referenced objects/locations in Scene",
    )
    expect(CTA_BY_CODE.dof_mismatch).toContain('compatible robot')
  })

  it('planning_error with an IK failure signature gets the reach-specific CTA', () => {
    const err = new ApiError('IK failed at waypoint 7 — MaxIterations reached', {
      code: 'planning_error',
    })
    expect(describeError(err)).toBe(
      "Targets are out of the robot's reach — adjust scene positions or load a larger robot — IK failed at waypoint 7 — MaxIterations reached",
    )
  })

  it('planning_error without an IK signature falls back to the generic planning CTA', () => {
    const err = new ApiError('Collision on segment 3', { code: 'planning_error' })
    expect(describeError(err)).toBe(
      'Planning failed — check the robot and scene targets — Collision on segment 3',
    )
  })
})

describe('describeError — unknown code falls back to message (error-ux spec)', () => {
  it('renders message with code when the code is unknown', () => {
    const err = new ApiError('Something broke', { code: 'unknown_thing' })
    expect(describeError(err)).toBe('Something broke (unknown_thing)')
  })

  it('includes the HTTP status only as complementary display', () => {
    const err = new ApiError('Something broke', {
      code: 'unknown_thing',
      status: 500,
    })
    expect(describeError(err)).toBe(
      'Something broke (unknown_thing, HTTP 500)',
    )
  })

  it('returns the bare message when an ApiError has no code', () => {
    const err = new ApiError('Backend is unreachable')
    expect(describeError(err)).toBe('Backend is unreachable')
  })
})

describe('describeError — non-ApiError fallback (error-ux spec)', () => {
  it('returns the message of a plain Error', () => {
    expect(describeError(new Error('Network down'))).toBe('Network down')
  })

  it('returns a neutral fallback for non-error input', () => {
    expect(describeError(null)).toBe('Operation failed')
    expect(describeError('plain string')).toBe('Operation failed')
  })
})

// ── Resilience matrix codes (PR1/PR2 — resilience-presentation) ────────────

describe('CTA_BY_CODE — resilience matrix codes (error-ux spec)', () => {
  it('maps network_error to the backend-offline guide', () => {
    expect(CTA_BY_CODE.network_error).toContain('Backend is offline')
  })

  it('maps timeout_error to the retry guide', () => {
    expect(CTA_BY_CODE.timeout_error).toContain('Request timed out')
  })

  it('maps no_firmware to the simulation-switch guide', () => {
    expect(CTA_BY_CODE.no_firmware).toContain('No firmware detected')
  })

  it('maps port_in_use to the port-selection guide', () => {
    expect(CTA_BY_CODE.port_in_use).toContain('Port is in use')
  })

  it('maps connection_lost to the reconnect guide', () => {
    expect(CTA_BY_CODE.connection_lost).toContain('Connection lost')
  })

  it('maps not_connected to the connect-backend guide (R3-001)', () => {
    expect(CTA_BY_CODE.not_connected).toContain('backend')
  })

  it('maps not_found to the catalog-return guide', () => {
    expect(CTA_BY_CODE.not_found).toContain('Robot not found')
  })
})

describe('ctaLabelForCode — short actionable button labels (error-ux spec)', () => {
  it('network_error → Retry', () => {
    expect(ctaLabelForCode('network_error')).toBe('Retry')
  })

  it('timeout_error → Retry', () => {
    expect(ctaLabelForCode('timeout_error')).toBe('Retry')
  })

  it('no_firmware → Switch to Simulation', () => {
    expect(ctaLabelForCode('no_firmware')).toBe('Switch to Simulation')
  })

  it('port_in_use → Choose another port', () => {
    expect(ctaLabelForCode('port_in_use')).toBe('Choose another port')
  })

  it('connection_lost → Reconnect', () => {
    expect(ctaLabelForCode('connection_lost')).toBe('Reconnect')
  })

  it('not_connected → Connect (R3-001)', () => {
    expect(ctaLabelForCode('not_connected')).toBe('Connect')
  })

  it('not_found → Back to catalog', () => {
    expect(ctaLabelForCode('not_found')).toBe('Back to catalog')
  })

  it('unknown or missing code → Retry fallback', () => {
    expect(ctaLabelForCode('weird_code')).toBe('Retry')
    expect(ctaLabelForCode(undefined)).toBe('Retry')
  })
})
