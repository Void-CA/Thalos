import { describe, expect, it } from 'vitest'
import { DurationDto, type RuntimeProgram } from '@/shared/contracts'

// Backend IR-3 runtime program (runtime.rs): events sorted by absolute
// at_time from plan start. A WaitOp(1500ms) event fires at 1.5s, which serde
// emits as {secs: 1, nanos: 500_000_000}.
const fixture = {
  events: [
    {
      at_time: { secs: 0, nanos: 0 },
      operation_id: 'op-move',
      action: { Delay: { secs: 0, nanos: 250_000_000 } },
    },
    {
      at_time: { secs: 1, nanos: 500_000_000 },
      operation_id: 'op-wait',
      action: { Delay: { secs: 0, nanos: 750_000_000 } },
    },
    {
      at_time: { secs: 2, nanos: 500_000_000 },
      operation_id: 'op-set',
      action: {
        SetOutput: {
          channel: { name: 'gripper', channel_type: 'digital' },
          value: { Bool: true },
        },
      },
    },
  ],
} satisfies RuntimeProgram

const WIRE = JSON.stringify(fixture)

/** Decode the wire JSON against the contract type (pure type-level decode). */
function decode(raw: string): RuntimeProgram {
  return JSON.parse(raw) as RuntimeProgram
}

describe('RuntimeEvent.at_time', () => {
  it('preserves WaitOp(1500ms) as {secs: 1, nanos: 500_000_000}', () => {
    const program = decode(WIRE)
    const wait = program.events.find((e) => e.operation_id === 'op-wait')
    expect(wait).toBeDefined()
    expect(wait?.at_time).toEqual({ secs: 1, nanos: 500_000_000 })
  })

  it('agrees with the Wait serializer DurationDto.fromSeconds(1.5)', () => {
    // CT/DurationDto-WaitOp: the frontend serializes the Wait op duration with
    // the same {secs, nanos} shape the backend emits for at_time.
    const program = decode(WIRE)
    const wait = program.events.find((e) => e.operation_id === 'op-wait')
    expect(DurationDto.fromSeconds(1.5)).toEqual(wait?.at_time)
  })

  it('preserves every at_time value exactly', () => {
    const program = decode(WIRE)
    const times = program.events.map((e) => e.at_time)
    expect(times).toEqual([
      { secs: 0, nanos: 0 },
      { secs: 1, nanos: 500_000_000 },
      { secs: 2, nanos: 500_000_000 },
    ])
  })

  it('keeps the event order sorted by at_time', () => {
    const program = decode(WIRE)
    expect(program.events.map((e) => e.operation_id)).toEqual([
      'op-move',
      'op-wait',
      'op-set',
    ])
  })

  it('rides the opaque action payload through untouched', () => {
    const program = decode(WIRE)
    expect(program.events[1].action).toEqual({ Delay: { secs: 0, nanos: 750_000_000 } })
    expect(program.events[2].action).toHaveProperty('SetOutput')
  })
})
