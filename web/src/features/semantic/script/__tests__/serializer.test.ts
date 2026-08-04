import { describe, it, expect } from 'vitest'
import { serialize } from '../serializer'
import type { SemanticOp } from '@/shared/contracts'

/**
 * Canonical Task Script serializer (program-text-serializer spec).
 *
 * The text view is a pure projection of `SemanticOp[]` — deterministic
 * (same program → identical bytes) and canonical (no format preservation).
 * These tests are the acceptance criteria for S1.2: op order preserved,
 * `at` mandatory for place, `tool=` conditional, readable duration rule
 * (P7), origins never emitted, no trailing blank line.
 */

describe('serialize — empty program (spec: Empty program serializes to empty string)', () => {
  it('returns "" for an empty program', () => {
    expect(serialize([])).toBe('')
  })
})

describe('serialize — single operations (spec: Grammar Conformance)', () => {
  it('serializes a pick without tool', () => {
    expect(serialize([{ type: 'pick', object: 'bolt-1' }])).toBe('pick bolt-1')
  })

  it('serializes a pick with tool arg', () => {
    expect(serialize([{ type: 'pick', object: 'bolt-1', tool: 'gripper-1' }])).toBe(
      'pick bolt-1 tool=gripper-1',
    )
  })

  it('emits the mandatory "at" keyword for place', () => {
    expect(
      serialize([{ type: 'place', object: 'bolt-1', destination: 'tray-1' }]),
    ).toBe('place bolt-1 at tray-1')
  })

  it('serializes place with tool arg after the destination', () => {
    expect(
      serialize([{ type: 'place', object: 'bolt-1', destination: 'tray-1', tool: 'gripper-1' }]),
    ).toBe('place bolt-1 at tray-1 tool=gripper-1')
  })

  it('serializes move_to without tool', () => {
    expect(serialize([{ type: 'move_to', destination: 'station-2' }])).toBe('move_to station-2')
  })

  it('serializes move_to with tool arg', () => {
    expect(serialize([{ type: 'move_to', destination: 'station-2', tool: 'gripper-1' }])).toBe(
      'move_to station-2 tool=gripper-1',
    )
  })

  it('serializes home', () => {
    expect(serialize([{ type: 'home' }])).toBe('home')
  })
})

describe('serialize — duration formatting (spec: Duration Formatting)', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(
      serialize([{ type: 'wait', duration: { secs: 0, nanos: 500_000_000 } }]),
    ).toBe('wait 500ms')
  })

  it('formats whole seconds as <n>s', () => {
    expect(
      serialize([{ type: 'wait', duration: { secs: 2, nanos: 0 } }]),
    ).toBe('wait 2s')
  })

  it('formats fractional seconds as <n>s', () => {
    expect(
      serialize([{ type: 'wait', duration: { secs: 1, nanos: 500_000_000 } }]),
    ).toBe('wait 1.5s')
  })

  it('formats sub-second fractions without trailing zeros (1.25s, 1.005s)', () => {
    expect(serialize([{ type: 'wait', duration: { secs: 3, nanos: 250_000_000 } }])).toBe(
      'wait 3.25s',
    )
    expect(serialize([{ type: 'wait', duration: { secs: 1, nanos: 5_000_000 } }])).toBe(
      'wait 1.005s',
    )
  })

  it('formats zero duration as 0ms', () => {
    expect(
      serialize([{ type: 'wait', duration: { secs: 0, nanos: 0 } }]),
    ).toBe('wait 0ms')
  })
})

describe('serialize — origin omission (spec: Origin Omission)', () => {
  it('never emits origin fields', () => {
    const ops: SemanticOp[] = [
      { type: 'pick', origin: 'op_1', object: 'bolt-1' },
      { type: 'wait', origin: 'op_2', duration: { secs: 1, nanos: 0 } },
    ]
    expect(serialize(ops)).toBe('pick bolt-1\nwait 1s')
  })
})

describe('serialize — full program (spec: Full sample program serializes)', () => {
  it('serializes a multi-op program in order, one op per line, no trailing blank line', () => {
    const ops: SemanticOp[] = [
      { type: 'pick', object: 'bolt-1' },
      { type: 'wait', duration: { secs: 1, nanos: 0 } },
      { type: 'place', object: 'bolt-1', destination: 'tray-1' },
      { type: 'home' },
    ]
    expect(serialize(ops)).toBe('pick bolt-1\nwait 1s\nplace bolt-1 at tray-1\nhome')
  })
})

describe('serialize — determinism (S1.2)', () => {
  const ops: SemanticOp[] = [
    { type: 'pick', origin: 'op_1', object: 'bolt-1', tool: 'gripper-1' },
    { type: 'wait', origin: 'op_2', duration: { secs: 1, nanos: 500_000_000 } },
    { type: 'place', origin: 'op_3', object: 'bolt-1', destination: 'tray-1' },
    { type: 'move_to', origin: 'op_4', destination: 'station-2' },
    { type: 'home', origin: 'op_5' },
  ]

  it('produces EXACTLY the same bytes on consecutive calls', () => {
    const first = serialize(ops)
    const second = serialize(ops)
    expect(second).toBe(first)
  })

  it('produces the same representation for operationally equivalent programs', () => {
    // Same ops, different (or missing) origins → identical text.
    const withoutOrigins: SemanticOp[] = ops.map(({ origin: _origin, ...rest }) => rest)
    expect(serialize(withoutOrigins)).toBe(serialize(ops))
  })
})
