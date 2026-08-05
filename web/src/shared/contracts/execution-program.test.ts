import { describe, expect, it } from 'vitest'
import type { ExecutionProgram } from '@/shared/contracts'

// Wire payloads mirror `thalos-core/src/execution/program.rs` (serde
// tag="type", rename_all="snake_case") plus `motion/target.rs` shapes:
// - MoveJ/MoveL → target (MotionTarget: {"type":"pose",position,orientation,frame})
//   + profile (MotionProfile: max_velocity/max_acceleration/max_jerk)
// - Delay → duration (DurationDto {secs,nanos})
// - SetOutput → channel (OutputChannel name/channel_type) + value
//   (OutputValue, externally tagged: {Bool}, {Integer}, {Float})
const fixture = {
  instructions: [
    {
      type: 'move_j',
      origin: 'op_1',
      target: {
        type: 'pose',
        position: [1.0, 0.0, 0.0],
        orientation: [0.0, 0.0, 0.0, 1.0],
        frame: 'world',
      },
      profile: { max_velocity: 100.0, max_acceleration: 200.0, max_jerk: null },
    },
    {
      type: 'move_l',
      origin: 'op_2',
      target: {
        type: 'pose',
        position: [2.0, 0.0, 0.0],
        orientation: [0.0, 0.0, 0.0, 1.0],
        frame: 'base',
      },
      profile: { max_velocity: 300.0, max_acceleration: 600.0, max_jerk: 900.0 },
    },
    { type: 'delay', origin: 'op_3', duration: { secs: 2, nanos: 0 } },
    {
      type: 'set_output',
      origin: 'op_4',
      channel: { name: 'gripper', channel_type: 'digital' },
      value: { Bool: true },
    },
  ],
  metadata: { schema_version: 1, source_project: 'test' },
} satisfies ExecutionProgram

const WIRE = JSON.stringify(fixture)

/** Decode the wire JSON against the contract type (pure type-level decode). */
function decode(raw: string): ExecutionProgram {
  return JSON.parse(raw) as ExecutionProgram
}

describe('ExecutionInstruction discriminated union (frontend-contract-types spec R1)', () => {
  it('decodes move_j with target + profile payloads', () => {
    const [instr] = decode(WIRE).instructions
    // The union SHALL narrow on `type`: without this guard, `target` and
    // `profile` are not accessible (R1 exhaustive union).
    if (instr.type !== 'move_j') throw new Error(`expected move_j, got ${instr.type}`)
    expect(instr.origin).toBe('op_1')
    expect(instr.target).toEqual({
      type: 'pose',
      position: [1, 0, 0],
      orientation: [0, 0, 0, 1],
      frame: 'world',
    })
    expect(instr.profile).toEqual({
      max_velocity: 100,
      max_acceleration: 200,
      max_jerk: null,
    })
  })

  it('decodes move_l with target + profile payloads', () => {
    const instr = decode(WIRE).instructions[1]
    if (instr.type !== 'move_l') throw new Error(`expected move_l, got ${instr.type}`)
    expect(instr.origin).toBe('op_2')
    expect(instr.target).toEqual({
      type: 'pose',
      position: [2, 0, 0],
      orientation: [0, 0, 0, 1],
      frame: 'base',
    })
    expect(instr.profile).toEqual({
      max_velocity: 300,
      max_acceleration: 600,
      max_jerk: 900,
    })
  })

  it('decodes delay with a DurationDto payload', () => {
    const instr = decode(WIRE).instructions[2]
    if (instr.type !== 'delay') throw new Error(`expected delay, got ${instr.type}`)
    expect(instr.origin).toBe('op_3')
    expect(instr.duration).toEqual({ secs: 2, nanos: 0 })
  })

  it('decodes set_output with channel + value payloads', () => {
    const instr = decode(WIRE).instructions[3]
    if (instr.type !== 'set_output') throw new Error(`expected set_output, got ${instr.type}`)
    expect(instr.origin).toBe('op_4')
    expect(instr.channel).toEqual({ name: 'gripper', channel_type: 'digital' })
    expect(instr.value).toEqual({ Bool: true })
  })

  it('preserves instruction order and program metadata', () => {
    const program = decode(WIRE)
    expect(program.instructions.map((i) => i.type)).toEqual([
      'move_j',
      'move_l',
      'delay',
      'set_output',
    ])
    expect(program.metadata).toEqual({ schema_version: 1, source_project: 'test' })
  })
})
