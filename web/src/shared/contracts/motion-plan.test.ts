import { describe, expect, it } from 'vitest'
import type { MotionPlanResponse, RuntimeProgram } from '@/shared/contracts'

// Backend `POST /motion/plan` response (motion dto responses.rs): the compiled
// IR-3 plan (opaque to the frontend) plus the absolute-timed runtime program.
const fixture = {
  compiled_plan: {
    segments: [{ target_joints: [0.0, 0.0], profile: { max_speed: 1.0 } }],
  },
  runtime_program: {
    events: [
      {
        at_time: { secs: 0, nanos: 0 },
        operation_id: 'op-1',
        action: { Delay: { secs: 0, nanos: 250_000_000 } },
      },
      {
        at_time: { secs: 1, nanos: 500_000_000 },
        operation_id: 'op-2',
        action: {
          SetOutput: {
            channel: { name: 'gripper', channel_type: 'digital' },
            value: { Bool: true },
          },
        },
      },
    ],
  },
} satisfies MotionPlanResponse

const WIRE = JSON.stringify(fixture)

/** Decode the wire JSON against the contract type (pure type-level decode). */
function decode(raw: string): MotionPlanResponse {
  return JSON.parse(raw) as MotionPlanResponse
}

describe('MotionPlanResponse', () => {
  it('decodes compiled_plan and runtime_program from the fixture', () => {
    const res = decode(WIRE)
    expect(res.compiled_plan).toBeTruthy()
    expect(res.runtime_program).toBeTruthy()
    expect(Array.isArray(res.runtime_program.events)).toBe(true)
    expect(res.runtime_program.events).toHaveLength(2)
  })

  it('keeps compiled_plan opaque and unmodified', () => {
    const res = decode(WIRE)
    expect(res.compiled_plan).toHaveProperty('segments')
    expect(res.compiled_plan).toEqual(fixture.compiled_plan)
  })

  it('decodes runtime_program as a typed RuntimeProgram', () => {
    const res = decode(WIRE)
    const program: RuntimeProgram = res.runtime_program
    expect(program.events[0].operation_id).toBe('op-1')
    expect(program.events[1].at_time).toEqual({ secs: 1, nanos: 500_000_000 })
    expect(program.events[1].action).toHaveProperty('SetOutput')
  })
})
