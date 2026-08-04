import { describe, it, expect } from 'vitest'
import golden from '../../../../../../test-fixtures/script-golden.json'
import { parse } from '../parser'
import type { SemanticOp } from '@/shared/contracts'

/**
 * Shared golden corpus parity (program-text-parser spec I7, design P6).
 *
 * This suite iterates the SAME `test-fixtures/script-golden.json` array that
 * drives `backend/crates/thalos-semantic/tests/golden_corpus.rs` — the TS
 * parser and the Rust `script::parse` must agree on every case, so any
 * grammar drift on either side turns one of the two suites red.
 *
 * The corpus has 22 cases: 17 positive (expected_ops) + 5 negative
 * (expected_ops: null, expected_errors with {line, contains}). The negative
 * "parse_multi_error_accumulation" case subsumes the standalone
 * `parse_pick_empty_errors` from script.rs (line 2 of that input IS `pick`),
 * so all 5 script.rs error commands stay covered.
 *
 * Origins are intentionally NOT part of the corpus (design P6 format): they
 * are derived `<command>-{line}` metadata asserted separately in
 * parser.test.ts. Op fields (type/object/destination/tool/duration_ms) are
 * the parity contract.
 */

interface GoldenOp {
  type: string
  object: string | null
  destination: string | null
  tool: string | null
  duration_ms: number | null
}

interface GoldenEntry {
  name: string
  input: string
  expected_ops: GoldenOp[] | null
  expected_errors: Array<{ line: number; contains: string }>
}

const corpus = golden as unknown as GoldenEntry[]

/** Assert one parsed op against its expected corpus entry (duration in ms). */
function expectOpMatches(op: SemanticOp, expected: GoldenOp, name: string): void {
  const prefix = `${name}: ${op.type}`
  expect(op.type).toBe(expected.type)
  if (expected.object != null) expect(op.object).toBe(expected.object)
  if (expected.destination != null) expect(op.destination).toBe(expected.destination)
  if (expected.tool != null) expect(op.tool).toBe(expected.tool)
  if (expected.duration_ms != null) {
    expect(op.duration).toEqual({
      secs: Math.floor(expected.duration_ms / 1000),
      nanos: (expected.duration_ms % 1000) * 1_000_000,
    })
  }
  void prefix
}

describe('golden corpus — shared with the Rust parser (I7)', () => {
  it('has exactly 22 cases: 17 positive + 5 negative', () => {
    const positive = corpus.filter((c) => c.expected_ops !== null)
    const negative = corpus.filter((c) => c.expected_ops === null)
    expect(corpus).toHaveLength(22)
    expect(positive).toHaveLength(17)
    expect(negative).toHaveLength(5)
  })

  it('keeps the corpus self-consistent: positives expect no errors, negatives expect no ops', () => {
    for (const entry of corpus) {
      if (entry.expected_ops !== null) {
        expect(entry.expected_errors).toEqual([])
      } else {
        expect(entry.expected_errors.length).toBeGreaterThan(0)
      }
    }
  })

  for (const entry of corpus) {
    const positive = entry.expected_ops !== null
    it(`${positive ? 'accepts' : 'rejects'} — ${entry.name}`, () => {
      const result = parse(entry.input)

      if (positive) {
        if (result.ops === null) {
          throw new Error(
            `${entry.name}: expected ops, got errors: ${JSON.stringify(result.errors)}`,
          )
        }
        const expected = entry.expected_ops as GoldenOp[]
        expect(result.ops).toHaveLength(expected.length)
        result.ops.forEach((op, i) => expectOpMatches(op, expected[i], entry.name))
      } else {
        expect(result.ops).toBeNull()
        const expected = entry.expected_errors
        expect(result.errors).toHaveLength(expected.length)
        result.errors.forEach((err, i) => {
          expect(err.line).toBe(expected[i].line)
          expect(err.message).toContain(expected[i].contains)
        })
      }
    })
  }
})
