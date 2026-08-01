/**
 * Backend contract DTOs - single source of truth for the JSON payload shapes
 * produced by `thalos_api`. Mirrors the serde shapes of the backend (IR-3
 * runtime, IR-1 execution program, semantic handler). Pure data types plus
 * serializers - no React, no per-feature duplication.
 */

/** `std::time::Duration` serde shape: `{ secs, nanos }` (0 <= nanos < 1e9). */
export interface DurationDto {
  secs: number
  nanos: number
}

export const DurationDto = {
  /** Serialize a duration in seconds to the wire `{secs, nanos}` shape.
   *  Math: secs = floor(dt), nanos = round((dt - secs) * 1e9), carrying any
   *  rounded nanos >= 1e9 into secs so the invariant 0 <= nanos < 1e9 holds.
   *  Rejects negatives with a RangeError. Never emits a float in the payload. */
  fromSeconds(durationSeconds: number): DurationDto {
    if (durationSeconds < 0) throw new RangeError('duration must be >= 0')
    let secs = Math.floor(durationSeconds)
    let nanos = Math.round((durationSeconds - secs) * 1_000_000_000)
    if (nanos >= 1_000_000_000) {
      secs += 1
      nanos -= 1_000_000_000
    }
    return { secs, nanos }
  },
}

/** A single runtime event in a `RuntimeProgram` (IR-3), linked back to the
 *  originating operation via `operation_id`. `at_time` is absolute from plan
 *  start; `action` is the opaque internally-tagged `RuntimeAction` payload. */
export interface RuntimeEvent {
  at_time: DurationDto
  operation_id: string
  action: unknown
}

/** Ordered linear set of runtime events (sorted by `at_time` by the backend). */
export interface RuntimeProgram {
  events: RuntimeEvent[]
}

/** A single IR-1 instruction - internally tagged `type` with an `origin`
 *  linking back to the source operation. Variant-specific fields (target,
 *  profile, duration, channel, value) ride alongside `type` + `origin`. */
export interface ExecutionInstruction {
  type: 'move_j' | 'move_l' | 'delay' | 'set_output'
  origin: string
}

/** The core execution program - linear instructions plus provenance metadata. */
export interface ExecutionProgram {
  instructions: ExecutionInstruction[]
  metadata: { schema_version: number; source_project: string }
}

/** Response from `POST /motion/plan` - compiled plan (opaque to the frontend)
 *  plus the IR-3 runtime program. */
export interface MotionPlanResponse {
  compiled_plan: unknown
  runtime_program: RuntimeProgram
}

/** Response from `POST /semantic/execute` - the JSON literal produced by the
 *  semantic handler. `duration_secs` is the backend-computed execution total,
 *  NOT the Wait-op serialization. */
export interface ExecuteSemanticResponse {
  status: string
  segment_count: number
  duration_secs: number
  waypoints: unknown[]
  event_count: number
}

/** Processing metadata attached to `CompileResponse`. */
export interface CompileMetadata {
  instruction_count: number
}
