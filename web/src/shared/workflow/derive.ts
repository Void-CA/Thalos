import type { WorkflowSnapshot, WorkflowState, WorkspaceEntry, WorkflowFlag } from './types'
import type { SemanticOp, PoseDef } from '@/shared/contracts'
import type { ExecutionStatus } from '@/features/execution/execution-store'

/**
 * Operation validation lifted from the task editor (design: workflow-state
 * spec, `programValid`). True when any operation references a missing resource —
 * a pick without an object, a place without object/destination, a move_to
 * without destination, or a wait with a zero duration.
 */
export function hasMissingFields(operations: readonly SemanticOp[]): boolean {
  return operations.some(
    (op) =>
      (op.type === 'pick' && !op.object) ||
      (op.type === 'place' && (!op.object || !op.destination)) ||
      (op.type === 'move_to' && !op.destination) ||
      (op.type === 'wait' &&
        (!op.duration || (op.duration.secs === 0 && op.duration.nanos === 0))),
  )
}

// ── Scene/program reference reconciliation (scene-load sync) ────────────────
//
// Load Scene replaces ONLY the scene store (invariant "Load Scene ≠ Load
// Program"), so a program written for the previous scene can keep referencing
// ids that no longer exist — Run then fails at backend lowering with
// `unknown object '…'`. These helpers reconcile the program to a freshly
// loaded scene so the "load a scene → run it" flow works end-to-end.

/** Minimal scene resource shape the remap needs (id + optional label). */
export interface SceneResourceRef {
  id: string
  name?: string | null
}

/** Resolve one program reference against a scene resource list:
 *  1. the id still exists → unchanged;
 *  2. a resource whose NAME matches (case-insensitive) → that id;
 *  3. exactly one resource exists → that id (unambiguous);
 *  4. otherwise → the original reference (the backend reports it clearly).
 *  Ordering is deliberate: exact-id and name matches are precise; the
 *  single-resource fallback only fires when the choice is unambiguous. */
function remapRef(ref: string, resources: readonly SceneResourceRef[]): string {
  if (resources.some((r) => r.id === ref)) return ref
  const byName = resources.find(
    (r) => r.name != null && r.name.toLowerCase() === ref.toLowerCase(),
  )
  if (byName) return byName.id
  if (resources.length === 1) return resources[0].id
  return ref
}

/** Re-map program operation references to a freshly loaded scene (objects +
 *  locations). Pure: returns the SAME array reference when nothing changed,
 *  so callers can detect a no-op by reference equality and skip dirty bumps. */
export function remapProgramToScene(
  operations: readonly SemanticOp[],
  objects: readonly SceneResourceRef[],
  locations: readonly SceneResourceRef[],
): readonly SemanticOp[] {
  let changed = false
  const next = operations.map((op) => {
    if (op.type === 'pick') {
      const object = remapRef(op.object ?? '', objects)
      if (object !== op.object) {
        changed = true
        return { ...op, object }
      }
      return op
    }
    if (op.type === 'place') {
      let out = op
      const object = remapRef(op.object ?? '', objects)
      if (object !== op.object) {
        changed = true
        out = { ...out, object }
      }
      const destination = remapRef(op.destination ?? '', locations)
      if (destination !== op.destination) {
        changed = true
        out = { ...out, destination }
      }
      return out
    }
    if (op.type === 'move_to') {
      const destination = remapRef(op.destination ?? '', locations)
      if (destination !== op.destination) {
        changed = true
        return { ...op, destination }
      }
      return op
    }
    return op
  })
  return changed ? next : operations
}

/** References still missing from the scene after remapping (deduped,
 *  `"object 'x'"` / `"location 'y'"` fragments for a human message). */
export function unresolvedProgramRefs(
  operations: readonly SemanticOp[],
  objects: readonly SceneResourceRef[],
  locations: readonly SceneResourceRef[],
): string[] {
  const objectIds = new Set(objects.map((o) => o.id))
  const locationIds = new Set(locations.map((l) => l.id))
  const missing: string[] = []
  for (const op of operations) {
    if (op.type === 'pick' && op.object && !objectIds.has(op.object)) {
      missing.push(`object '${op.object}'`)
    } else if (op.type === 'place') {
      if (op.object && !objectIds.has(op.object)) missing.push(`object '${op.object}'`)
      if (op.destination && !locationIds.has(op.destination)) {
        missing.push(`location '${op.destination}'`)
      }
    } else if (op.type === 'move_to' && op.destination && !locationIds.has(op.destination)) {
      missing.push(`location '${op.destination}'`)
    }
  }
  return [...new Set(missing)]
}

/** execStatus values that count as "a plan is loaded and runnable". */
const EXECUTABLE_STATUSES: readonly ExecutionStatus[] = ['ready', 'running', 'paused']
/** execStatus values that count as "execution is in progress". */
const RUNNING_STATUSES: readonly ExecutionStatus[] = ['running', 'paused']

/**
 * Home-pose validity (workflow-state spec derivation table: `sceneValid` =
 * `objects.length >= 1 && validHomePose`). A pose is valid when both vectors
 * are structurally complete and finite — guards against NaN / partial home
 * poses leaking in from the scene editor.
 */
export function isValidHomePose(pose: PoseDef | null | undefined): boolean {
  if (!pose) return false
  const { position, orientation } = pose
  return (
    position.length === 3 &&
    orientation.length === 4 &&
    position.every((v) => Number.isFinite(v)) &&
    orientation.every((v) => Number.isFinite(v))
  )
}

/**
 * Pure derivation of workflow flags from a store snapshot (spec:
 * workflow-state, "Pure Derivation Hook"). No React, no subscriptions, no
 * side effects — every flag is a pure function of the snapshot.
 *
 * The flags form the artifact chain (R2: RobotModel → Scene → SemanticProgram
 * → MotionPlan → Runtime), so each downstream flag requires the upstream one:
 * `sceneValid ⇒ robotLoaded`, `programValid ⇒ sceneValid`,
 * `compiled ⇒ programValid`, `executable ⇒ planReady` — impossible states are
 * impossible by construction (tasks.md C1). The scene/program split keeps the
 * two validities separately meaningful: a scene can be valid while the program
 * is still incomplete.
 *
 * PR2: `planReady` covers BOTH plan sources — the Task compile handoff
 * (`compiled`) and the Planning preview path (`scene.activePlanPresent`, a
 * plan mirrored into the viewport scene store). `executable` is rebased on
 * `planReady` so a previewed Motion Program is runnable even though `compiled`
 * stays false.
 */
export function deriveWorkflowState(snapshot: WorkflowSnapshot): WorkflowState {
  const sceneValid =
    snapshot.scene.robotLoaded &&
    snapshot.scene.objects.length >= 1 &&
    snapshot.scene.validHomePose
  const programValid =
    sceneValid &&
    snapshot.task.operations.length >= 1 &&
    !hasMissingFields(snapshot.task.operations)
  const compiled =
    programValid &&
    snapshot.compile.result !== null &&
    snapshot.compile.dirty === 0
  const planReady = compiled || snapshot.scene.activePlanPresent
  const status = snapshot.execution.status

  return {
    robotLoaded: snapshot.scene.robotLoaded,
    sceneValid,
    programValid,
    compiled,
    planReady,
    analyzed: snapshot.analysis.report !== null,
    executable: planReady && EXECUTABLE_STATUSES.includes(status),
    // Terminal statuses stay in the Execution workspace: a finished run
    // (Completed/Failed) must remain viewable instead of tripping the guard
    // and redirecting away from /execution the moment it ends.
    executionViewable:
      (planReady && EXECUTABLE_STATUSES.includes(status)) ||
      status === 'completed' ||
      status === 'failed',
    running: RUNNING_STATUSES.includes(status),
    completed: status === 'completed',
  }
}

// ── Stepper + status derivations (global-stepper spec) ──────────────────────
//
// The stepper is the workflow pipeline (Robot → Scene → Programming →
// Evaluation → Execution → Sessions — 6 steps since the evaluation-workspace
// hotfix) and everything it shows derives from the registry + WorkflowState:
// stage order and labels come from WORKSPACE_REGISTRY (the `stage` field),
// stage states from the flags. No per-workspace strings live in the views.

/**
 * Human-readable phrase per workflow flag — the ONLY string source for blocked
 * reasons. Keyed by flag name, not by workspace: the stepper and top-bar reuse
 * it so a blocked stage's message changes with the missing flag instead of
 * being a fixed per-view string.
 */
const FLAG_PHRASES: Record<WorkflowFlag, string> = {
  robotLoaded: 'a loaded robot',
  sceneValid: 'a valid scene',
  programValid: 'a valid program',
  compiled: 'a compiled plan',
  planReady: 'a plan',
  analyzed: 'an analyzed plan',
  executable: 'an executable plan',
  executionViewable: 'a runnable or finished execution',
  running: 'a running execution',
  completed: 'a completed execution',
}

/**
 * Registry entries that form the stepper pipeline, ordered by the registry
 * `stage` field — the domain pipeline position (Robot=1 … Sesiones=6). This
 * replaced the old PIPELINE_CAPABILITIES capability filter, which excluded
 * Robot and Escena: the stepper is a PROJECTION of the area registry (ADR
 * ui-as-domain-projection, criterion C1), never a parallel stage list.
 *
 * Only `kind === 'stage'` (the default) entries render — auxiliary tools
 * (`kind: 'tool'`, auxiliary-tools-navigation spec) are never pipeline stages.
 * The `kind` check is DEFENSIVE: tools already carry `stage: null`, so the
 * stage filter hides them today; the kind filter guarantees a future tool that
 *  mistakenly gains a stage number still never renders in the stepper. Areas
 *  with `stage: null` (knowledge; Configuration when it lands in S5 —
 *  area-configuration spec "not a stepper stage") are not pipeline stages.
 * NOTE (C2, for verify): `stepperIndex` is currently redundant — it equals
 * `stage` on every pipeline area; `stage` is the canonical order key. */
export function stepperStages(registry: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return registry
    .filter(
      (entry): entry is WorkspaceEntry & { stage: number } =>
        (entry.kind ?? 'stage') === 'stage' && entry.stage !== null,
    )
    .sort((a, b) => a.stage - b.stage)
}

/** Per-stage state in the stepper (global-stepper spec: passed/current/pending/blocked). */
export type StageState = 'passed' | 'current' | 'pending' | 'blocked'

export interface StepperStage {
  entry: WorkspaceEntry
  state: StageState
  /** Derived from the first missing requirement — null when the stage is not blocked. */
  reason: string | null
}

/**
 * First missing requirement of a registry entry, rendered from the flag name
 * (never a per-workspace hardcoded string). Returns null when every
 * requirement is met.
 */
export function requirementReason(
  entry: Pick<WorkspaceEntry, 'requires'>,
  flags: WorkflowState,
): string | null {
  const missing = entry.requires.find((flag) => !flags[flag])
  if (!missing) return null
  return `Requires ${FLAG_PHRASES[missing]}`
}

/**
 * Pure derivation of the stepper stages (global-stepper spec, "Workflow-Driven
 * Stages"). For every pipeline stage:
 * - the active route is `current`;
 * - a stage with an unmet requirement is `blocked` (reason from the missing flag);
 *   Robot (requires []) is never blocked — it is the stage-1 entry point;
 * - a stage that already produced its output, or sits before the current one in
 *   pipeline order, is `passed`;
 * - anything else is `pending` (future stage, requirements met).
 */
export function deriveStepperStages(
  flags: WorkflowState,
  activePath: string,
  registry: readonly WorkspaceEntry[],
): StepperStage[] {
  const stages = stepperStages(registry)
  const activeIndex = stages.findIndex((entry) => entry.path === activePath)

  return stages.map((entry, index) => {
    if (entry.path === activePath) {
      return { entry, state: 'current', reason: null }
    }
    const reason = requirementReason(entry, flags)
    if (reason) {
      return { entry, state: 'blocked', reason }
    }
    const produced = entry.produces !== null && flags[entry.produces]
    const beforeCurrent = activeIndex !== -1 && index < activeIndex
    if (produced || beforeCurrent) {
      return { entry, state: 'passed', reason: null }
    }
    return { entry, state: 'pending', reason: null }
  })
}

/**
 * Short status line derived from the workflow flags (S2: the status bar must
 * reflect the real workflow state, never a static string). Single line,
 * consistent with `useWorkflowState`.
 */
export function deriveStatusMessage(state: WorkflowState): string {
  if (!state.robotLoaded) return 'No robot loaded'
  if (!state.sceneValid) return 'Scene incomplete'
  if (!state.programValid) return 'Task incomplete'
  if (state.running) return 'Plan running'
  if (state.completed) return 'Plan completed — review in Sessions'
  // R3-001: branch on executable BEFORE compiled — a previewed Motion Program is
  // runnable with `compiled:false` (planReady via scene.activePlanPresent), so
  // it must report as ready instead of the stale-compile message. The compiled
  // check below only triggers when nothing runnable exists.
  if (state.executable) {
    return state.compiled
      ? 'Plan ready to run'
      : 'Motion Program ready — send to execution'
  }
  if (!state.compiled) return 'Task modified — recompilation required'
  if (state.analyzed) return 'Plan analyzed'
  return 'Robot loaded · Task compiled'
}
