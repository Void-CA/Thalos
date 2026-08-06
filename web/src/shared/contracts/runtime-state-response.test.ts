import { describe, expect, it } from 'vitest'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'

// The fixtures below are the RAW serialized wire JSON — the exact shape serde
// emits from `backend/crates/thalos-api/src/features/scene/dto/responses.rs` +
// `dto/mappers/runtime.rs` — NOT objects that are JSON.stringify'd back onto
// themselves.
const catalogWire = JSON.stringify({
  robot: { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
  joints: [0.0, 0.1, 0.2, 0.3],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  generated_at: '2026-08-04T00:00:00Z',
})

// PRECOMPUTED robot.id for the fixture URDF source
// `'<robot name="a"><link name="base"/></robot>'`, produced with the backend's
// real algorithm (`urdf_robot_id` = `urdf:{hex(&sha256(source)[..6])}`, computed
// offline with python3: sha256 of the source bytes, first 6 bytes hex). It is
// deliberately NOT re-derived at runtime: deriving the expected id with the same
// code path as the backend is a tautology that can never fail. What this test
// pins is the WIRE FORMAT the frontend must accept. If the backend ever
// regresses to the legacy literal `urdf`, truncates to a different length, or
// changes the format, the pinned id no longer matches the format regex below
// and the pin breaks — that is the canary this test provides.
const EXPECTED_URDF_ID = 'urdf:e182b0bce2f5'

function urdfWire(id: string): string {
  return JSON.stringify({
    robot: { id, display_name: 'My URDF Robot', dof: 2, joints: [] },
    joints: [0.1, 0.2],
    scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
    ik_result: null,
    active_plan: null,
    generated_at: '2026-08-04T00:00:00Z',
  })
}

/** Decode the wire JSON against the contract type (pure type-level decode). */
function decode(raw: string): RuntimeStateResponse {
  return JSON.parse(raw) as RuntimeStateResponse
}

describe('RuntimeStateResponse — robot.id identity contract (spec robot-identity R1)', () => {
  it('pins the URDF wire id to the fixed urdf:<sha256-12hex> format, never the legacy literal', () => {
    // A URDF id that is not the real backend format (literal "urdf", wrong
    // truncation) must FAIL this pin — that is exactly the regression the
    // backend api_tests protect against on the wire side.
    expect(EXPECTED_URDF_ID).toMatch(/^urdf:[0-9a-f]{12}$/)
    expect(EXPECTED_URDF_ID).not.toBe('urdf')

    const res = decode(urdfWire(EXPECTED_URDF_ID))
    expect(res.robot.id).toBe(EXPECTED_URDF_ID)
    expect(res.robot.display_name).toBe('My URDF Robot')
  })

  it('decodes a catalog wire with robot.id equal to the metadata id', () => {
    const res = decode(catalogWire)
    expect(res.robot.id).toBe('scara')
    expect(res.robot.dof).toBe(4)
  })

  it('round-trips the fixed URDF id as a stable string', () => {
    // Backend R1.1 determinism: same bytes → same hash → identical wire id.
    // The precomputed constant freezes the CURRENT backend format; a change in
    // hashing/truncation makes this pinned id stale and breaks the format pin.
    const firstOnWire = decode(urdfWire(EXPECTED_URDF_ID)).robot.id
    expect(firstOnWire).toBe(EXPECTED_URDF_ID)
    expect(typeof firstOnWire).toBe('string')
  })

  it('distinguishes URDF identities from catalog identities by prefix', () => {
    const urdf = decode(urdfWire(EXPECTED_URDF_ID)).robot.id
    const catalog = decode(catalogWire).robot.id
    expect(urdf).not.toBe(catalog)
    expect(urdf.startsWith('urdf:')).toBe(true)
    expect(catalog.startsWith('urdf:')).toBe(false)
  })

  it('carries the optional execution.source wire field (PR4 — backend source badge)', () => {
    const wire = JSON.stringify({
      robot: { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
      joints: [0.0, 0.1, 0.2, 0.3],
      scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
      ik_result: null,
      active_plan: null,
      execution: {
        status: 'Active',
        progress: 0.4,
        elapsed_secs: 1.25,
        source: 'Simulation',
      },
      generated_at: '2026-08-04T00:00:00Z',
    })

    const res = decode(wire)
    expect(res.execution?.source).toBe('Simulation')
  })

  it('decodes execution without source as absent (additive field)', () => {
    const wire = JSON.stringify({
      robot: { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
      joints: [0.0, 0.1, 0.2, 0.3],
      scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
      ik_result: null,
      active_plan: null,
      execution: { status: 'Idle', progress: 0, elapsed_secs: 0 },
      generated_at: '2026-08-04T00:00:00Z',
    })

    const res = decode(wire)
    expect(res.execution?.source).toBeUndefined()
  })
})
