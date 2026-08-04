import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import { serialize } from '../serializer'
import type { SemanticOp } from '@/shared/contracts'

/**
 * Round-trip stability (program-text-serializer spec I2, design P7).
 *
 * `parse(serialize(ops))` must yield operationally equivalent operations:
 * same types, fields and order. Origins are derivation metadata — the
 * serializer never emits them (P7), the parser regenerates `<command>-{line}`,
 * so they may differ and are excluded from equivalence.
 *
 * Precondition (documented in serializer.ts / parser.ts): `serialize` renders
 * the store faithfully and expects a VALID SemanticOp; `parse` validates
 * syntax. A `wait` op with no duration is a degenerate model (type-switch UI
 * artifact) that serializes to the bare word "wait" — which the parser
 * correctly REJECTS ("'wait' requires a duration"). That asymmetry is
 * intended: the serializer shows the model as-is, the parser enforces the
 * grammar.
 */

/** Deep equality ignoring origins. */
function equivalent(a: SemanticOp[], b: SemanticOp[]): boolean {
  const strip = (op: SemanticOp) => {
    const { origin: _origin, ...rest } = op
    return rest
  }
  return JSON.stringify(a.map(strip)) === JSON.stringify(b.map(strip))
}

describe('roundtrip — parse(serialize(ops)) ≡ ops modulo origins (I2)', () => {
  it('round-trips a full program with all five commands', () => {
    const ops: SemanticOp[] = [
      { type: 'pick', object: 'bolt-1' },
      { type: 'wait', duration: { secs: 1, nanos: 0 } },
      { type: 'place', object: 'bolt-1', destination: 'tray-1' },
      { type: 'move_to', destination: 'station-2' },
      { type: 'home' },
    ]
    const r = parse(serialize(ops))
    expect(r.ops).not.toBeNull()
    expect(equivalent(r.ops as SemanticOp[], ops)).toBe(true)
  })

  it('round-trips tool arguments on pick, place and move_to', () => {
    const ops: SemanticOp[] = [
      { type: 'pick', object: 'bolt-1', tool: 'gripper-1' },
      { type: 'place', object: 'bolt-1', destination: 'tray-1', tool: 'gripper-1' },
      { type: 'move_to', destination: 'station-2', tool: 'gripper-1' },
    ]
    const r = parse(serialize(ops))
    expect(equivalent(r.ops as SemanticOp[], ops)).toBe(true)
  })

  it('round-trips every duration shape: 500ms, 2s, 1.5s, 3.25s, 1.005s', () => {
    const ops: SemanticOp[] = [
      { type: 'wait', duration: { secs: 0, nanos: 500_000_000 } },
      { type: 'wait', duration: { secs: 2, nanos: 0 } },
      { type: 'wait', duration: { secs: 1, nanos: 500_000_000 } },
      { type: 'wait', duration: { secs: 3, nanos: 250_000_000 } },
      { type: 'wait', duration: { secs: 1, nanos: 5_000_000 } },
    ]
    const r = parse(serialize(ops))
    expect(r.ops).not.toBeNull()
    expect(equivalent(r.ops as SemanticOp[], ops)).toBe(true)
  })

  it('round-trips the empty program to an empty ops list', () => {
    const r = parse(serialize([]))
    expect(r.ops).toEqual([])
  })

  it('regenerates origins in <command>-{line} form on the re-parse (I2 modulo origins)', () => {
    const r = parse(serialize([{ type: 'pick', object: 'bolt-1' }, { type: 'home' }]))
    expect(r.ops).toEqual([
      { type: 'pick', origin: 'pick-1', object: 'bolt-1', tool: undefined },
      { type: 'home', origin: 'home-2' },
    ])
  })
})

describe('documented precondition — degenerate wait serializes, parser rejects', () => {
  it('serializes a wait with no duration as the bare word "wait"', () => {
    expect(serialize([{ type: 'wait' }])).toBe('wait')
  })

  it('parser rejects bare "wait" — syntax validation stays strict', () => {
    const r = parse('wait')
    expect(r.ops).toBeNull()
    expect(r.errors[0]?.message).toContain("'wait' requires a duration")
  })
})
