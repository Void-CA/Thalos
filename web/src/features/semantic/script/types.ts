import type { SemanticOp } from '@/shared/contracts'

/** Mirror of `script.rs` `ParseError` (P3): 1-indexed line, same messages. */
export interface ParseError {
  line: number
  message: string
}

/** Mirror of `script.rs` `parse()` result: all ops, or null + accumulated errors. */
export type ParseResult =
  | { ops: SemanticOp[]; errors: [] }
  | { ops: null; errors: ParseError[] }
