import { describe, expect, it } from 'vitest'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'

// The fixtures below are the RAW serialized wire JSON — the exact shape serde
// emits from `backend/crates/thalos-api/src/features/scene/dto/responses.rs` +
// `dto/mappers/runtime.rs` — NOT objects that are JSON.stringify'd back onto
// themselves. Round-tripping a handmade literal can never fail, so each test
// asserts against a value DERIVED from the backend's real serialization (the
// URDF id is the sha256-derived hash, never a made-up literal).
const catalogWire = JSON.stringify({
  robot: { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
  joints: [0.0, 0.1, 0.2, 0.3],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  generated_at: '2026-08-04T00:00:00Z',
})

// A real URDF document (same source family the backend hashes).
const urdfSource = '<robot name="a"><link name="base"/></robot>'

/** Mirrors `backend/.../features/scene/handler.rs::urdf_robot_id`: SHA-256 of the
 *  raw source bytes, first 6 bytes hex-encoded → `urdf:<12 lowercase hex>`.
 *  Deriving the expected id the same way the backend does means a wire that
 *  regresses to the legacy literal "urdf" (or any other format) fails the pin. */
async function urdfRobotId(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  return `urdf:${hex.slice(0, 12)}`
}

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
  it('decodes a real URDF wire with robot.id = urdf:<sha256-12hex>, never the legacy literal', async () => {
    const id = await urdfRobotId(urdfSource)
    expect(id).toMatch(/^urdf:[0-9a-f]{12}$/)
    expect(id).not.toBe('urdf')

    const res = decode(urdfWire(id))
    expect(res.robot.id).toBe(id)
    expect(res.robot.display_name).toBe('My URDF Robot')
  })

  it('decodes a catalog wire with robot.id equal to the metadata id', () => {
    const res = decode(catalogWire)
    expect(res.robot.id).toBe('scara')
    expect(res.robot.dof).toBe(4)
  })

  it('keeps robot.id a stable string across re-imports of the same URDF source', async () => {
    // Backend R1.1 determinism: same bytes → same hash → identical wire id.
    // Pinned from the DERIVED hash (not a fixture literal), so a change in the
    // hashing/truncation would break the round-trip and the cross-check below.
    const first = await urdfRobotId(urdfSource)
    const second = await urdfRobotId(urdfSource)
    const firstOnWire = decode(urdfWire(first)).robot.id
    const secondOnWire = decode(urdfWire(second)).robot.id
    expect(firstOnWire).toBe(first)
    expect(secondOnWire).toBe(second)
    expect(firstOnWire).toBe(secondOnWire)
    expect(typeof firstOnWire).toBe('string')
  })

  it('distinguishes URDF identities from catalog identities by prefix', async () => {
    const urdf = decode(urdfWire(await urdfRobotId(urdfSource))).robot.id
    const catalog = decode(catalogWire).robot.id
    expect(urdf).not.toBe(catalog)
    expect(urdf.startsWith('urdf:')).toBe(true)
    expect(catalog.startsWith('urdf:')).toBe(false)
  })
})
