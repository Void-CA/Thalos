import type { DurationDto, SemanticOp } from '@/shared/contracts'

/**
 * Canonical Task Script serializer (program-text-serializer spec, design P7).
 *
 * Pure projection of `SemanticOp[]` — the text view renders ONLY what this
 * function returns (ADR ui-as-domain-projection). It never reads or writes
 * persistent state, never preserves user formatting, and is fully
 * deterministic: the same program always produces the exact same bytes.
 *
 * Canonical rules (P7):
 * - Operation order = `ops[]` array order; one op per line, no trailing blank.
 * - `pick <object>`, `place <object> at <location>`, `move_to <location>`,
 *   `wait <duration>`, `home` — `at` is always emitted for `place`.
 * - `tool=<name>` emitted only when the `tool` field is present.
 * - Durations: `<n>ms` below 1s, `<n>s` whole seconds, `<n>[.fraction]s`
 *   otherwise (e.g. `1.5s`, `3.25s`), rounded to millisecond granularity.
 * - Origins and comments are NEVER emitted (derivation metadata / syntax).
 */
export function serialize(ops: SemanticOp[]): string {
  return ops.map(serializeOp).join('\n')
}

function serializeOp(op: SemanticOp): string {
  switch (op.type) {
    case 'pick':
      return joinTokens(['pick', op.object, toolArg(op.tool)])
    case 'place':
      return joinTokens(['place', op.object, 'at', op.destination, toolArg(op.tool)])
    case 'move_to':
      return joinTokens(['move_to', op.destination, toolArg(op.tool)])
    case 'wait':
      return op.duration ? `wait ${formatDuration(op.duration)}` : 'wait'
    case 'home':
      return 'home'
  }
}

/** `tool=<name>` only when the field is present (P7: conditional arg). */
function toolArg(tool: string | undefined): string | undefined {
  return tool != null ? `tool=${tool}` : undefined
}

/** Canonical join: single spaces, absent/empty tokens dropped (P7 whitespace). */
function joinTokens(tokens: Array<string | undefined>): string {
  return tokens.filter((t): t is string => !!t).join(' ')
}

/**
 * Canonical duration rule (P7 + spec scenarios): milliseconds below 1s
 * (`500ms`), whole seconds (`2s`), fractional seconds with trailing zeros
 * trimmed (`1.5s`, `3.25s`, `1.005s`). Works in integer milliseconds to keep
 * the output byte-stable and parseable back at the grammar's ms granularity.
 */
function formatDuration(duration: DurationDto): string {
  const ms = duration.secs * 1000 + Math.round(duration.nanos / 1_000_000)
  if (ms < 1000) return `${ms}ms`
  const whole = Math.floor(ms / 1000)
  const fractionMs = ms % 1000
  if (fractionMs === 0) return `${whole}s`
  const fraction = String(fractionMs).padStart(3, '0').replace(/0+$/, '')
  return `${whole}.${fraction}s`
}
