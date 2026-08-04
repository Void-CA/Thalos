import { describe, it, expect } from 'vitest'
import { parse } from '../parser'
import type { ParseError } from '../types'

/**
 * Task Script parser unit tests (program-text-parser spec).
 *
 * These are the spec scenarios NOT covered by the shared golden corpus
 * (origins, exact messages, all-or-nothing result, comment/blank handling)
 * plus the isolated command/arity matrix. Golden-corpus parity lives in
 * golden.test.ts; round-trip stability in roundtrip.test.ts.
 */

describe('parse — five commands (spec: Grammar Conformance)', () => {
  it('parses pick with an object', () => {
    const r = parse('pick bolt')
    expect(r.ops).toEqual([{ type: 'pick', origin: 'pick-1', object: 'bolt', tool: undefined }])
  })

  it('parses place with the mandatory "at" keyword', () => {
    const r = parse('place bolt at tray')
    expect(r.ops).toEqual([
      { type: 'place', origin: 'place-1', object: 'bolt', destination: 'tray', tool: undefined },
    ])
  })

  it('parses move_to with a destination', () => {
    const r = parse('move_to station-2')
    expect(r.ops).toEqual([
      { type: 'move_to', origin: 'move_to-1', destination: 'station-2', tool: undefined },
    ])
  })

  it('parses wait durations in ms, whole seconds and fractional seconds', () => {
    const r = parse('wait 500ms\nwait 2s\nwait 1.5s')
    expect(r.ops).toEqual([
      { type: 'wait', origin: 'wait-1', duration: { secs: 0, nanos: 500_000_000 } },
      { type: 'wait', origin: 'wait-2', duration: { secs: 2, nanos: 0 } },
      { type: 'wait', origin: 'wait-3', duration: { secs: 1, nanos: 500_000_000 } },
    ])
  })

  it('parses home', () => {
    const r = parse('home')
    expect(r.ops).toEqual([{ type: 'home', origin: 'home-1' }])
  })
})

describe('parse — named arguments (spec: Named args parsed)', () => {
  it('extracts tool= on pick', () => {
    const r = parse('pick bolt tool=gripper-1')
    expect(r.ops).toEqual([{ type: 'pick', origin: 'pick-1', object: 'bolt', tool: 'gripper-1' }])
  })

  it('extracts tool= on place (after the destination)', () => {
    const r = parse('place bolt at tray tool=gripper-1')
    expect(r.ops).toEqual([
      { type: 'place', origin: 'place-1', object: 'bolt', destination: 'tray', tool: 'gripper-1' },
    ])
  })

  it('extracts tool= on move_to', () => {
    const r = parse('move_to station-2 tool=gripper-1')
    expect(r.ops).toEqual([
      { type: 'move_to', origin: 'move_to-1', destination: 'station-2', tool: 'gripper-1' },
    ])
  })

  it('treats unknown key=value args as named but ignores them (mirrors extract_named_args)', () => {
    const r = parse('pick bolt foo=bar')
    expect(r.ops).toEqual([{ type: 'pick', origin: 'pick-1', object: 'bolt', tool: undefined }])
  })
})

describe('parse — comment and blank line handling (spec: Comments and blank lines ignored)', () => {
  it('ignores comment lines and blank lines', () => {
    const r = parse('# comment\n\npick bolt\n  # another\nhome')
    expect(r.ops).toEqual([
      { type: 'pick', origin: 'pick-3', object: 'bolt', tool: undefined },
      { type: 'home', origin: 'home-5' },
    ])
  })

  it('collapses runs of whitespace inside a line (split_whitespace mirror)', () => {
    const r = parse('pick   bolt\t  ')
    expect(r.ops).toEqual([{ type: 'pick', origin: 'pick-1', object: 'bolt', tool: undefined }])
  })
})

describe('parse — origin regeneration (spec: Origins auto-generated)', () => {
  it('generates <command>-{line} origins counting ALL input lines', () => {
    const r = parse('# header\npick bolt\nhome')
    expect(r.ops).toEqual([
      { type: 'pick', origin: 'pick-2', object: 'bolt', tool: undefined },
      { type: 'home', origin: 'home-3' },
    ])
  })
})

describe('parse — syntactic validation only, no resource checks (spec I3)', () => {
  it('accepts unknown resources — validation is syntax-only', () => {
    const r = parse('pick unknown-object')
    expect(r.ops).toEqual([
      { type: 'pick', origin: 'pick-1', object: 'unknown-object', tool: undefined },
    ])
  })
})

describe('parse — localized, accumulated errors (spec I4)', () => {
  it('rejects an unknown command with line 1 and message "unknown command"', () => {
    const r = parse('jump 10')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([{ line: 1, message: "unknown command 'jump'" }])
  })

  it('rejects place without the "at" keyword with the format message', () => {
    const r = parse('place bolt tray')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([
      { line: 1, message: "'place' requires format: place <object> at <location>" },
    ])
  })

  it('rejects wait without a duration', () => {
    const r = parse('wait')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([{ line: 1, message: "'wait' requires a duration (e.g., 500ms, 2s)" }])
  })

  it('rejects an invalid duration with the expected-format message', () => {
    const r = parse('wait forever')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([
      { line: 1, message: "invalid duration 'forever': expected format like 500ms, 2s, or 1.5s" },
    ])
  })

  it('rejects home with arguments', () => {
    const r = parse('home somewhere')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([
      { line: 1, message: "'home' takes no arguments, got: somewhere" },
    ])
  })

  it('rejects pick with no object', () => {
    const r = parse('pick')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([{ line: 1, message: "'pick' requires at least an object name" }])
  })

  it('accumulates errors across lines and does NOT stop at the first error (I4)', () => {
    const r = parse('jump 10\npick\nwait forever')
    expect(r.ops).toBeNull()
    expect(r.errors).toEqual([
      { line: 1, message: "unknown command 'jump'" },
      { line: 2, message: "'pick' requires at least an object name" },
      { line: 3, message: "invalid duration 'forever': expected format like 500ms, 2s, or 1.5s" },
    ])
  })

  it('reports the exact source line when the error is on a later line', () => {
    const r = parse('pick bolt\njump 10')
    const lines = r.errors.map((e: ParseError) => e.line)
    expect(lines).toEqual([2])
  })
})

describe('parse — all-or-nothing result (R2 foundation)', () => {
  it('returns ops: null whenever ANY line fails, discarding valid lines (mirror of Rust Err)', () => {
    const r = parse('pick bolt\njump 10')
    expect(r.ops).toBeNull()
    expect(r.errors).toHaveLength(1)
  })

  it('returns an empty ops list (not null) for an empty/comment-only program', () => {
    expect(parse('').ops).toEqual([])
    expect(parse('# nothing here').ops).toEqual([])
  })
})

describe('parse — 1:1 mirror edge cases (R1 triangulation of script.rs)', () => {
  it("'wait ms' errors — Rust f64 parse of '' fails, Number('') is 0 (guard)", () => {
    const r = parse('wait ms')
    expect(r.ops).toBeNull()
    expect(r.errors[0]?.message).toBe("invalid duration 'ms'")
  })

  it("'place a at b at c' ignores trailing positional tokens exactly like script.rs", () => {
    const r = parse('place a at b at c')
    expect(r.ops).toEqual([
      { type: 'place', origin: 'place-1', object: 'a', destination: 'b', tool: undefined },
    ])
  })

  it("'wait 2s tool=x' ignores trailing tokens — parse_wait reads only args[0]", () => {
    const r = parse('wait 2s tool=x')
    expect(r.ops).toEqual([{ type: 'wait', origin: 'wait-1', duration: { secs: 2, nanos: 0 } }])
  })

  it('parses CRLF line endings identically (str::lines() strips trailing \\r)', () => {
    const r = parse('pick bolt\r\nhome')
    expect(r.ops).toEqual([
      { type: 'pick', origin: 'pick-1', object: 'bolt', tool: undefined },
      { type: 'home', origin: 'home-2' },
    ])
  })
})
