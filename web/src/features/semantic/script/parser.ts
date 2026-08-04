import type { DurationDto, SemanticOp } from '@/shared/contracts'
import type { ParseError, ParseResult } from './types'

/**
 * Task Script parser — structural 1:1 mirror of
 * `backend/crates/thalos-semantic/src/script.rs` (design P1/P2).
 *
 * This is a mechanical, imperative translation: same functions
 * (`parse` / `parse_line` / `extract_named_args` / `extract_tool` /
 * `parse_pick` / `parse_place` / `parse_move_to` / `parse_duration` /
 * `parse_wait`), same control flow (`split_whitespace` → dispatch on the
 * first token), same error messages, same 1-indexed line numbers (P3).
 * There is deliberately NO lexer: script.rs does not have one either (P2).
 *
 * The shared golden corpus (`test-fixtures/script-golden.json`) drives both
 * this parser and `script::parse` — any intentional grammar change must land
 * in BOTH implementations or one test suite goes red (I7).
 *
 * R2 atomicity contract: `parse` is all-or-nothing like Rust's `Result` —
 * if ANY line fails, the result is `{ ops: null, errors }` and the caller
 * (task-editor Apply) must NOT touch the store. No partial programs exist.
 *
 * Precondition (documented, mirrors the serializer): the parser validates
 * SYNTAX ONLY (I3). It never checks resource existence — that flows through
 * compile. A `wait` with no duration is rejected, which is coherent with the
 * serializer rendering the store faithfully: a degenerate `wait` model op
 * serializes to bare "wait" and the parser refuses it.
 */

/** LineResult mirrors Rust's `Result<SemanticOperation, ParseError>`. */
type LineResult = { ok: true; op: SemanticOp } | { ok: false; error: ParseError }

const err = (line: number, message: string): LineResult => ({ ok: false, error: { line, message } })
const ok = (op: SemanticOp): LineResult => ({ ok: true, op })

/** Mirror of `script.rs parse()` — accumulate ops and errors, all-or-nothing. */
export function parse(text: string): ParseResult {
  const operations: SemanticOp[] = []
  const errors: ParseError[] = []

  // `str::lines()` yields no trailing empty element for a final "\n"; the
  // extra empty slot from split('\n') is skipped by the same trim+skip check.
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const lineNum = i + 1 // 1-indexed, counts ALL input lines (origins too)

    // Skip empty lines and comments — same predicate as script.rs.
    if (line === '' || line.startsWith('#')) {
      continue
    }

    const result = parseLine(line, lineNum)
    if (result.ok) operations.push(result.op)
    else errors.push(result.error)
  }

  if (errors.length > 0) {
    return { ops: null, errors }
  }
  return { ops: operations, errors: [] }
}

/** Mirror of `script.rs parse_line` — split_whitespace + command dispatch. */
function parseLine(line: string, lineNum: number): LineResult {
  // split_whitespace() collapses runs of any whitespace; a trimmed non-empty
  // line always yields >= 1 token, but the guard mirrors Rust exactly.
  const parts = line.split(/\s+/)
  if (parts.length === 0) {
    return err(lineNum, 'empty line')
  }

  const command = parts[0]
  const args = parts.slice(1)

  switch (command) {
    case 'pick':
      return parsePick(args, lineNum)
    case 'place':
      return parsePlace(args, lineNum)
    case 'move_to':
      return parseMoveTo(args, lineNum)
    case 'wait':
      return parseWait(args, lineNum)
    case 'home': {
      if (args.length > 0) {
        return err(lineNum, `'home' takes no arguments, got: ${args.join(' ')}`)
      }
      return ok({ type: 'home', origin: `home-${lineNum}` })
    }
    default:
      return err(lineNum, `unknown command '${command}'`)
  }
}

/** Mirror of `script.rs extract_named_args` — split positional vs key=value
 *  at the FIRST '=' of each token (value keeps any later '=' chars). */
function extractNamedArgs(args: string[]): [string[], Array<[string, string]>] {
  const positional: string[] = []
  const named: Array<[string, string]> = []
  for (const arg of args) {
    const eqPos = arg.indexOf('=')
    if (eqPos !== -1) {
      named.push([arg.slice(0, eqPos), arg.slice(eqPos + 1)])
    } else {
      positional.push(arg)
    }
  }
  return [positional, named]
}

/** Mirror of `script.rs extract_tool` — FIRST named arg keyed "tool". */
function extractTool(named: Array<[string, string]>): string | undefined {
  const found = named.find(([key]) => key === 'tool')
  return found?.[1]
}

/** Mirror of `script.rs parse_pick`: pick <object> [tool=<name>]. */
function parsePick(args: string[], lineNum: number): LineResult {
  const [pos, named] = extractNamedArgs(args)

  if (pos.length === 0) {
    return err(lineNum, "'pick' requires at least an object name")
  }

  return ok({
    type: 'pick',
    origin: `pick-${lineNum}`,
    object: pos[0],
    tool: extractTool(named),
  })
}

/** Mirror of `script.rs parse_place`: place <object> at <location> [tool=<name>].
 *  Positional tokens after the location are silently ignored (as in Rust). */
function parsePlace(args: string[], lineNum: number): LineResult {
  const [pos, named] = extractNamedArgs(args)

  // Expected: place <object> at <location>
  if (pos.length < 3 || pos[1] !== 'at') {
    return err(lineNum, "'place' requires format: place <object> at <location>")
  }

  return ok({
    type: 'place',
    origin: `place-${lineNum}`,
    object: pos[0],
    destination: pos[2],
    tool: extractTool(named),
  })
}

/** Mirror of `script.rs parse_move_to`: move_to <location> [tool=<name>]. */
function parseMoveTo(args: string[], lineNum: number): LineResult {
  const [pos, named] = extractNamedArgs(args)

  if (pos.length === 0) {
    return err(lineNum, "'move_to' requires a location name")
  }

  return ok({
    type: 'move_to',
    origin: `move_to-${lineNum}`,
    destination: pos[0],
    tool: extractTool(named),
  })
}

/**
 * Mirror of `std::time::Duration::from_secs_f64`: whole seconds are the
 * truncated part, nanos = round(fraction * 1e9) with carry, and the Rust
 * float→u64/u32 casts saturate negatives to 0. Used so the TS duration DTO
 * matches the Rust parser bit-for-bit for every parseable input.
 */
function fromSecsF64(seconds: number): DurationDto {
  const whole = Math.trunc(seconds)
  const nanos = Math.round((seconds - whole) * 1_000_000_000)
  let secs = whole
  let rem = nanos
  if (rem >= 1_000_000_000) {
    secs += 1
    rem -= 1_000_000_000
  }
  return { secs: Math.max(0, secs), nanos: Math.max(0, rem) }
}

/** Rust `"".parse::<f64>()` fails, but `Number("")` is 0 — replicate Err. */
function parseF64(s: string): number {
  return s === '' ? Number.NaN : Number(s)
}

/** Mirror of `script.rs parse_duration` — real implementation. The `Duration`
 *  is converted to the wire `{secs, nanos}` DTO exactly like the Rust backend
 *  serializes it (DurationDto). */
function parseDurationReal(value: string, lineNum: number): DurationDto | ParseError {
  if (value.endsWith('ms')) {
    const val = parseF64(value.slice(0, -2))
    if (Number.isNaN(val)) return { line: lineNum, message: `invalid duration '${value}'` }
    return fromSecsF64(val / 1000.0)
  }
  if (value.endsWith('s')) {
    const val = parseF64(value.slice(0, -1))
    if (Number.isNaN(val)) return { line: lineNum, message: `invalid duration '${value}'` }
    return fromSecsF64(val)
  }
  return {
    line: lineNum,
    message: `invalid duration '${value}': expected format like 500ms, 2s, or 1.5s`,
  }
}

/** Mirror of `script.rs parse_wait`: wait <duration>. Extra args ignored. */
function parseWait(args: string[], lineNum: number): LineResult {
  if (args.length === 0) {
    return err(lineNum, "'wait' requires a duration (e.g., 500ms, 2s)")
  }

  const duration = parseDurationReal(args[0], lineNum)
  if ('message' in duration) {
    return { ok: false, error: duration }
  }

  return ok({ type: 'wait', origin: `wait-${lineNum}`, duration })
}
