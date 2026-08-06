import type { Area, WorkspaceEntry, WorkflowFlag } from './types'
export type { Area, ArtifactKind, Capability, WorkspaceEntry, WorkspaceName } from './types'

/**
 * Single declarative navigation + guard contract (design: WORKSPACE_REGISTRY,
 * D1 — the registry describes domain AREAS, not views).
 *
 * Every workspace declares what it `requires` (WorkflowState flags), what it
 * `produces`, its exclusive `capability` (invariant #7), and its place in the
 * artifact chain (`consumes`/`producesArtifact`, R2) with a `stage` marker.
 *  Routes, guards, stepper and breadcrumbs all derive from this array — no
 *  ad-hoc nav rules live anywhere else.
 *
 *  Labels are domain vocabulary (navigation-router spec): Robot / Escena /
 *  Programación / Ejecución / Sesiones / Configuración. Robot carries a stage
 *  marker (stage 1) even though it has no prerequisite. The legacy
 *  plan-analysis `/analysis` was absorbed into `/planning` in slice 6; PR-D
 *  re-introduces `/analysis` as the SAMPLING tool (kind: 'tool' — reach /
 *  singularity / manipulability), distinct from plan-analysis. The sitemap is
 *  `/`, `/scene`, `/task`, `/execution`, `/sessions` (visible since S5),
 *  `/knowledge` (hidden), `/configuration` (non-stage shell, S5) and
 *  `/analysis` (auxiliary tool).
 *
 *  HOTFIX (unify-programming): `/planning` was ABSORBED into `/task`. Both
 *  areas were the same thing — commanding the robot with different syntaxes —
 *  so there is ONE programming workspace (/task, stage 3) with two tabs:
 *  Programa (semantic editor, Visual/Text) and Motion Program (segment
 *  editor). Decisions:
 *  - `produces: 'compiled'` — the origin flag of `planReady`; producerOf keeps
 *    the "no plan at all → /task" guard UX.
 *  - `producesArtifact: 'MotionPlan'` — the final plan artifact handed to
 *    /evaluation and /execution. SemanticProgram is the INTERMEDIATE artifact
 *    authored inside the Programa tab; the C3 artifact chain stays contiguous
 *    (Scene → MotionPlan → MotionPlan → Runtime).
 *  - `capability: 'compile'` — the unified workspace keeps the compile
 *    capability; planning's `optimize` dies with the area.
 *  - The analysis TAB was REMOVED from this workspace in the
 *    evaluation-workspace hotfix — the analysis check is now a first-class
 *    pre-execution VISTA at /evaluation (stage 4).
 *
 *  HOTFIX (evaluation-workspace): the analysis check stops being a tab inside
 *  Programación and becomes a VISTA of its own — an EVALUACIÓN pre-ejecución
 *  between Programación and Ejecución: "¿estás seguro que querés ejecutar
 *  esto?" with concrete actions. Decisions:
 *  - `/evaluation` (stage 4) requires `['sceneValid', 'planReady']` — it
 *    evaluates an EXISTING plan (Tasks compile or Motion preview); it never
 *    requires the executable status.
 *  - `produces: 'analyzed'` — RESTORES the producer the flag lost when
 *    /planning was absorbed; the flag chain is contiguous again
 *    (… planReady → analyzed → executable) and Knowledge's guard (requires
 *    analyzed) now redirects to /evaluation.
 *  - `consumes: 'MotionPlan'`, `producesArtifact: 'MotionPlan'` — a
 *    pass-through: evaluating a plan does not transform it, so C3 stays
 *    contiguous (task MotionPlan → evaluation MotionPlan → execution).
 *  - `capability: null` — the `optimize` capability has no runtime consumer
 *    (planning's died); the optimize action renders inside the evaluation
 *    view without claiming an exclusive capability.
 *  - `layout: 'full'` — the evaluation view takes the whole shell body; the
 *    viewport is not rendered so the decision is the focus.
 *  - `/execution` does NOT require `analyzed`: evaluation is a RECOMMENDED
 *    checkpoint, not a hard gate — the fast path (compile → execute) keeps
 *    working. Documented decision (CDD evaluation-workspace).
 *  - Stepper becomes 6 steps: Robot → Escena → Programación → Evaluación →
 *    Ejecución → Sesiones (execution stage 5, sessions stage 6).
 *
 *  S3.6: typed as `Area[]` (design D1 — the registry describes domain AREAS,
 *  not views). The stepper, guards, breadcrumbs and pipeline derivations all
 *  draw from this one source; the stage/stepperIndex/consumes/produces fields
 *  make the pipeline graph fully derivable.
 */
export const WORKSPACE_REGISTRY: Area[] = [
  { path: '/', workspace: 'robot', label: 'Robot', requires: [], produces: 'robotLoaded', capability: null, hidden: false, consumes: 'URDF', producesArtifact: 'RobotModel', stage: 1, stepperIndex: 1 },
  { path: '/scene', workspace: 'scene', label: 'Escena', requires: ['robotLoaded'], produces: 'sceneValid', capability: null, hidden: false, consumes: 'RobotModel', producesArtifact: 'Scene', stage: 2, stepperIndex: 2 },
  // Unified programming workspace (hotfix unify-programming): /planning merged
  // into /task. One workspace, two tabs (Tasks / Motion). The gate stays
  // `sceneValid`, NOT `compiled` — the Motion Program is built from
  // /scene/preview, so an uncompiled program never blocks access (D2 rule
  // carried over from the old /planning entry).
  { path: '/task', workspace: 'task', label: 'Programación', requires: ['sceneValid'], produces: 'compiled', capability: 'compile', hidden: false, consumes: 'Scene', producesArtifact: 'MotionPlan', stage: 3, stepperIndex: 3 },
  // Pre-execution EVALUACIÓN (hotfix evaluation-workspace): the analysis check
  // leaves Programación and becomes a first-class decision VISTA. Requires an
  // EXISTING plan (sceneValid + planReady — Tasks compile or Motion preview);
  // produces `analyzed` (restored producer — Knowledge's guard lands here).
  // MotionPlan pass-through for the C3 chain; layout 'full' hides the viewport.
  { path: '/evaluation', workspace: 'evaluation', label: 'Evaluación', requires: ['sceneValid', 'planReady'], produces: 'analyzed', capability: null, hidden: false, consumes: 'MotionPlan', producesArtifact: 'MotionPlan', stage: 4, stepperIndex: 4, layout: 'full' },
  // PR2 (workflow-guards spec): Execution gates on planReady (compiled ∨
  // sceneActivePlanPresent) so BOTH plan paths — Program handoff and Motion
  // Program preview — satisfy the guard. producerOf('planReady') resolves to
  // the producer of its origin (compiled) so "no plan at all" still redirects
  // to /task, the workspace that compiles a plan. `analyzed` is NOT required:
  // evaluation is a recommended checkpoint, not a hard gate.
  { path: '/execution', workspace: 'execution', label: 'Ejecución', requires: ['sceneValid', 'planReady', 'executable'], produces: 'completed', capability: 'execute', hidden: false, consumes: 'MotionPlan', producesArtifact: 'Runtime', stage: 5, stepperIndex: 5 },
  // S5.1 AUDIT verdict (area-sessions spec): the `completed` requirement was
  // REMOVED from /sessions — the browser must show failed/running sessions
  // (status filters), so the guard no longer gates the area. `completed` stays
  // a derived flag (execution still produces it; the status bar consumes it).
  { path: '/sessions', workspace: 'sessions', label: 'Sesiones', requires: [], produces: null, capability: 'replay', hidden: false, consumes: 'Runtime', producesArtifact: 'ExecutionSession', stage: 6, stepperIndex: 6 },
  { path: '/knowledge', workspace: 'knowledge', label: 'Knowledge', requires: ['analyzed'], produces: null, capability: 'explain', hidden: true, consumes: null, producesArtifact: null, stage: null },
  { path: '/configuration', workspace: 'configuration', label: 'Configuración', requires: [], produces: null, capability: null, hidden: false, consumes: null, producesArtifact: null, stage: null },
  // D5 (flow-reorganization): /analysis is the SAMPLING tool (reach /
  // singularity / manipulability), kind:'tool' — NOT a pipeline stage.
  // Auxiliary-tools-navigation spec: stage null (no stepper position),
  // requires robotLoaded (the workspace samples a real robot). Distinct from
  // plan-analysis (useAnalysisStore.report absorbed into the unified /task
  // workspace in slice 6, kept there after the unify-programming hotfix).
  { path: '/analysis', workspace: 'analysis', label: 'Analysis', requires: ['robotLoaded'], produces: null, capability: null, hidden: false, consumes: null, producesArtifact: null, stage: null, kind: 'tool' },
]

/**
 * Derived flags no workspace produces directly — mapped to the flag whose
 * producer the guard should land on. `planReady` is DERIVED (`compiled ∨
 * sceneActivePlanPresent`): when NO plan exists at all, the guard redirects to
 * the producer of its compiled origin (/task) instead of the root — keeping
 * the "no plan → Programación" UX (workflow-guards spec, "No plan at all
 * redirects to Task"). `analyzed` IS produced directly by /evaluation since
 * the evaluation-workspace hotfix — Knowledge's guard (requires analyzed)
 * redirects there when the plan isn't evaluated.
 */
const DERIVED_FLAG_ORIGIN: Partial<Record<WorkflowFlag, WorkflowFlag>> = {
  planReady: 'compiled',
}

/**
 * Find the workspace that produces a given flag — used by guard redirects
 * (design: producerOf). Fully declarative: maps WorkflowFlag → WorkspaceEntry;
 * knows nothing about components or ad-hoc routes. Derived flags (planReady)
 * resolve through their origin flag (compiled).
 */
export function producerOf(flag: WorkflowFlag): WorkspaceEntry | undefined {
  const origin = DERIVED_FLAG_ORIGIN[flag] ?? flag
  return WORKSPACE_REGISTRY.find((entry) => entry.produces === origin)
}
