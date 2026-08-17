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

/** `MotionTarget` — mirrors `thalos_core::motion::target::MotionTarget`
 *  (serde `tag = "type"`, `rename_all = "snake_case"`). Currently a single
 *  `Pose` variant carrying a robot-independent pose. */
export type MotionTarget = {
  type: 'pose'
  position: [number, number, number]
  orientation: [number, number, number, number]
  frame: string
}

/** `MotionProfile` — mirrors `MotionProfile`: resolved numeric limits for an
 *  instruction. `max_jerk` is optional because not all backends support jerk
 *  limiting (serde `Option<f64>` → `number | null`). */
export interface MotionProfile {
  max_velocity: number
  max_acceleration: number
  max_jerk: number | null
}

/** `OutputChannel` — mirrors `OutputChannel`: human-readable `name` plus the
 *  electrical/logical `channel_type` string. */
export interface OutputChannel {
  name: string
  channel_type: string
}

/** `OutputValue` — mirrors `OutputValue` (serde externally-tagged enum):
 *  `{ Bool: true }`, `{ Integer: 42 }` or `{ Float: 3.14 }`. */
export type OutputValue =
  | { Bool: boolean }
  | { Integer: number }
  | { Float: number }

/** A single IR-1 instruction — internally tagged `type` (serde
 *  `tag = "type"`, `rename_all = "snake_case"`) with an `origin` linking back
 *  to the source operation. Discriminated union over the 4 backend variants:
 *  MoveJ/MoveL (target+profile), Delay (duration), SetOutput (channel+value). */
export type ExecutionInstruction =
  | { type: 'move_j'; origin: string; target: MotionTarget; profile: MotionProfile }
  | { type: 'move_l'; origin: string; target: MotionTarget; profile: MotionProfile }
  | { type: 'delay'; origin: string; duration: DurationDto }
  | { type: 'set_output'; origin: string; channel: OutputChannel; value: OutputValue }

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
  /** Advisory warnings (semantic expert + validator), ADDITIVE (I3): the
   *  semantic handler emits the array; old backends omit it, so consumers
   *  must tolerate its absence. */
  warnings?: string[]
}

/** Processing metadata attached to `CompileResponse`. */
export interface CompileMetadata {
  instruction_count: number
}

// ── TaskDocument (scene + program) wire contract ─────────────────────────────
// The unified document posted to /semantic/compile and /semantic/execute.
// Moved here from features/semantic/types.ts in S2 so the Scene area can
// consume/produce it WITHOUT importing the Task feature (C4: Scene never
// imports Task — shared/contracts is the neutral home for wire shapes).

/** A single semantic operation as sent to the API */
export interface SemanticOp {
  type: 'pick' | 'place' | 'move_to' | 'wait' | 'home'
  origin?: string
  object?: string
  destination?: string
  tool?: string
  /** Wait duration — wire format `{secs, nanos}` (DurationDto), never a float */
  duration?: DurationDto
}

/** Pose definition for a resource */
export interface PoseDef {
  position: [number, number, number]
  orientation: [number, number, number, number]
}

/** A resource with an associated pose (for the Scene) */
export interface SceneResourceDef {
  id: string
  name: string
  pose: PoseDef
  category?: string | null
  description?: string | null
}

/** SceneContent — the scene within a TaskDocument */
export interface SceneContent {
  objects: SceneResourceDef[]
  locations: SceneResourceDef[]
  tools: { id: string; name: string }[]
  home_pose: PoseDef
  /** SCARA approach/retreat transit height (metres): the Z offset above the
   *  grasp/drop pose where pick/place approach and retreat frames sit. The
   *  prismatic joint retracts to this height during transit. Backend default
   *  is 0.05 m when omitted. Always-on for MVP (no enable/disable toggle). */
  approach_height?: number
}

/** Metadata for a TaskDocument */
export interface DocMetadata {
  name: string
  version: number
  created_at: string
  modified_at: string
}

/** TaskDocument — unified scene + program */
export interface TaskDocument {
  id: string
  metadata: DocMetadata
  scene: SceneContent
  program: { operations: SemanticOp[] }
}

// ── SceneFile v1 artifact (D2/D4) ────────────────────────────────────────────
// The persistent, versioned, file-level scene artifact. SEPARATE from
// `SceneContent` (the in-memory TaskDocument projection) — never collapse the
// two (scene-file-artifact spec "Separation from SceneContent"). Mirrors the
// serde shape of `thalos_document::scene_file::SceneFile` 1:1 so files saved
// by the web are accepted by the backend and vice versa.

/** Robot reference — `name` is the STABLE identity (D11); the runtime ID
 *  (`urdf:<sha256-6hex>`) is derived and never persisted in demos. */
export interface RobotRef {
  name: string
  urdf: string
}

/** Visualization-only geometry descriptor (D4: dropped by the mapping). */
export interface GeometryDef {
  /** `"box" | "cylinder" | "sphere"` (unsupported types rejected at tier (b)). */
  type: string
  /** Dimensions in metres (box: [w,h,d]; cylinder: [r,h]; sphere: [r]). */
  size: number[]
}

/** A physical object — semantic `kind`, optional label, optional placement
 *  target reference, optional VISUALIZATION-ONLY geometry. */
export interface SceneObjectDef {
  id: string
  kind: string
  /** Human-readable label (optional; falls back to `id` in the mapping). */
  name?: string
  /** Optional placement target — MUST reference an id in `locations[]`. */
  location_ref?: string
  geometry?: GeometryDef
  pose: PoseDef
}

/** A presentational workspace fixture (fence, table, …) — geometry optional. */
export interface SceneFixtureDef {
  id: string
  geometry?: GeometryDef
  pose: PoseDef
}

/** A logical placement target — v1 supports `kind: "placement_target"`. */
export interface SceneLocationDef {
  id: string
  kind: string
  pose: PoseDef
}

/** SceneFile v1 — standalone JSON artifact describing a robot and its
 *  workspace. The web's Load/Save Scene IO path (D12) reads/writes exactly
 *  this shape; `useDomainSceneStore.loadSceneFile`/`serializeSceneFile`
 *  hydrate/export it via the domain store. */
export interface SceneFile {
  schema_version: string
  robot: RobotRef
  objects: SceneObjectDef[]
  fixtures: SceneFixtureDef[]
  locations: SceneLocationDef[]
  home_pose: PoseDef
  /** Approach/retreat transit height in metres (D6: 1:1 with SceneContent). */
  approach_height: number
}

/** One entry of the demo catalog (`GET /api/v1/demos`). Metadata only — the
 *  scene/program payloads are fetched separately by id (D10 catalog authority). */
export interface DemoCatalogEntry {
  id: string
  title: string
  category: string
  narrative?: string
}
