import { describe, expect, it } from 'vitest'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'

// Backend `RuntimeStateResponse` wire literal (scene handler → to_api_response).
// The robot identity contract (spec robot-identity R1): catalog robots carry
// `robot.id = metadata.id`; URDF imports carry `robot.id = urdf:<sha256-trunc-12>`
// of the raw XML — unique per file, deterministic across re-imports.
const urdfFixture = {
  robot: { id: 'urdf:a3f8b2c1d4e5', display_name: 'My URDF Robot', dof: 2, joints: [] },
  joints: [0.1, 0.2],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  generated_at: '2026-08-04T00:00:00Z',
} satisfies RuntimeStateResponse

const catalogFixture = {
  robot: { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
  joints: [0.0, 0.1, 0.2, 0.3],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  generated_at: '2026-08-04T00:00:00Z',
} satisfies RuntimeStateResponse

/** Decode the wire JSON against the contract type (pure type-level decode). */
function decode(raw: string): RuntimeStateResponse {
  return JSON.parse(raw) as RuntimeStateResponse
}

describe('RuntimeStateResponse — robot.id identity contract (spec robot-identity R1)', () => {
  it('decodes a URDF response with a urdf:*-prefixed robot.id', () => {
    const res = decode(JSON.stringify(urdfFixture))
    expect(res.robot.id).toMatch(/^urdf:[0-9a-f]{12}$/)
    expect(res.robot.display_name).toBe('My URDF Robot')
  })

  it('decodes a catalog response with robot.id equal to the metadata id', () => {
    const res = decode(JSON.stringify(catalogFixture))
    expect(res.robot.id).toBe('scara')
    expect(res.robot.dof).toBe(4)
  })

  it('keeps robot.id a stable string across wire round-trips', () => {
    const once = decode(JSON.stringify(urdfFixture)).robot.id
    const twice = decode(JSON.stringify(urdfFixture)).robot.id
    expect(once).toBe(twice)
    expect(typeof once).toBe('string')
  })

  it('distinguishes URDF identities from catalog identities by prefix', () => {
    const urdf = decode(JSON.stringify(urdfFixture)).robot.id
    const catalog = decode(JSON.stringify(catalogFixture)).robot.id
    expect(urdf).not.toBe(catalog)
    expect(urdf.startsWith('urdf:')).toBe(true)
    expect(catalog.startsWith('urdf:')).toBe(false)
  })
})
