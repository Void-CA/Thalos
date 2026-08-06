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
 *  so there is ONE programming workspace (/task, stage 3) with three tabs:
 *  Programa (semantic editor, Visual/Text), Motion Program (segment editor)
 *  and Analysis. Decisions:
 *  - `produces: 'compiled'` — the origin flag of `planReady`; producerOf keeps
 *    the "no plan at all → /task" guard UX. `analyzed` lost its producer
 *    (it stays a derived flag; Knowledge's guard falls back to the root).
 *  - `producesArtifact: 'MotionPlan'` — the final plan artifact handed to
 *    /execution. SemanticProgram is the INTERMEDIATE artifact authored inside
 *    the Programa tab; the C3 artifact chain stays contiguous
 *    (Scene → MotionPlan → Runtime).
 *  - `capability: 'compile'` — the unified workspace keeps the compile
 *    capability; planning's `optimize` dies with the area.
 *  - stage/stepperIndex 3, execution renumbered 4 and sessions 5 — the
 *    stepper is Robot → Escena → Programación → Ejecución → Sesiones (5 steps).
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
  // into /task. One workspace, three tabs (Programa / Motion Program /
  // Analysis). The gate stays `sceneValid`, NOT `compiled` — the Motion
  // Program is built from /scene/preview, so an uncompiled program never
  // blocks access (D2 rule carried over from the old /planning entry).
  { path: '/task', workspace: 'task', label: 'Programación', requires: ['sceneValid'], produces: 'compiled', capability: 'compile', hidden: false, consumes: 'Scene', producesArtifact: 'MotionPlan', stage: 3, stepperIndex: 3 },
  // PR2 (workflow-guards spec): Execution gates on planReady (compiled ∨
  // sceneActivePlanPresent) so BOTH plan paths — Program handoff and Motion
  // Program preview — satisfy the guard. producerOf('planReady') resolves to
  // the producer of its origin (compiled) so "no plan at all" still redirects
  // to /task, the workspace that compiles a plan.
  { path: '/execution', workspace: 'execution', label: 'Ejecución', requires: ['sceneValid', 'planReady', 'executable'], produces: 'completed', capability: 'execute', hidden: false, consumes: 'MotionPlan', producesArtifact: 'Runtime', stage: 4, stepperIndex: 4 },
  // S5.1 AUDIT verdict (area-sessions spec): the `completed` requirement was
  // REMOVED from /sessions — the browser must show failed/running sessions
  // (status filters), so the guard no longer gates the area. `completed` stays
  // a derived flag (execution still produces it; the status bar consumes it).
  { path: '/sessions', workspace: 'sessions', label: 'Sesiones', requires: [], produces: null, capability: 'replay', hidden: false, consumes: 'Runtime', producesArtifact: 'ExecutionSession', stage: 5, stepperIndex: 5 },
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
 * redirects to Task"). `analyzed` has no producer since /planning was absorbed
 * — Knowledge's guard falls back to the root when the plan isn't analyzed.
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
