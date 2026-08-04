import type { Area, WorkspaceEntry, WorkflowFlag } from './types'
export type { Area, ArtifactKind, Capability, WorkspaceEntry, WorkspaceName } from './types'

/**
 * Single declarative navigation + guard contract (design: WORKSPACE_REGISTRY,
 * D1 — the registry describes domain AREAS, not views).
 *
 * Every workspace declares what it `requires` (WorkflowState flags), what it
 * `produces`, its exclusive `capability` (invariant #7), and its place in the
 * artifact chain (`consumes`/`producesArtifact`, R2) with a `stage` marker.
 * Routes, guards, stepper and breadcrumbs all derive from this array — no
 * ad-hoc nav rules live anywhere else.
 *
 * Labels are domain vocabulary (navigation-router spec): Robot / Escena /
 * Programación / Planificación / Ejecución / Sesiones / Configuración. Robot
 * carries a stage marker (stage 1) even though it has no prerequisite. The
 * legacy `/analysis` workspace was absorbed into `/planning` in slice 6; it has
 * no registry entry and therefore no route — the sitemap is `/`, `/scene`,
 * `/task`, `/planning`, `/execution`, `/sessions` (visible since S5),
 * `/knowledge` (hidden) and `/configuration` (non-stage shell, S5).
 *
 * S3.6: typed as `Area[]` (design D1 — the registry describes domain AREAS,
 * not views). The stepper, guards, breadcrumbs and pipeline derivations all
 * draw from this one source; the stage/stepperIndex/consumes/produces fields
 * make the pipeline graph fully derivable.
 */
export const WORKSPACE_REGISTRY: Area[] = [
  { path: '/', workspace: 'robot', label: 'Robot', requires: [], produces: 'robotLoaded', capability: null, hidden: false, consumes: 'URDF', producesArtifact: 'RobotModel', stage: 1, stepperIndex: 1 },
  { path: '/scene', workspace: 'scene', label: 'Escena', requires: ['robotLoaded'], produces: 'sceneValid', capability: null, hidden: false, consumes: 'RobotModel', producesArtifact: 'Scene', stage: 2, stepperIndex: 2 },
  { path: '/task', workspace: 'task', label: 'Programación', requires: ['sceneValid'], produces: 'compiled', capability: 'compile', hidden: false, consumes: 'Scene', producesArtifact: 'SemanticProgram', stage: 3, stepperIndex: 3 },
  { path: '/planning', workspace: 'planning', label: 'Planificación', requires: ['compiled'], produces: 'analyzed', capability: 'optimize', hidden: false, consumes: 'SemanticProgram', producesArtifact: 'MotionPlan', stage: 4, stepperIndex: 4 },
  { path: '/execution', workspace: 'execution', label: 'Ejecución', requires: ['executable'], produces: 'completed', capability: 'execute', hidden: false, consumes: 'MotionPlan', producesArtifact: 'Runtime', stage: 5, stepperIndex: 5 },
  { path: '/sessions', workspace: 'sessions', label: 'Sesiones', requires: ['completed'], produces: null, capability: 'replay', hidden: false, consumes: 'Runtime', producesArtifact: 'ExecutionSession', stage: 6, stepperIndex: 6 },
  { path: '/knowledge', workspace: 'knowledge', label: 'Knowledge', requires: ['analyzed'], produces: null, capability: 'explain', hidden: true, consumes: null, producesArtifact: null, stage: null },
]

/**
 * Find the workspace that produces a given flag — used by guard redirects
 * (design: producerOf). Fully declarative: maps WorkflowFlag → WorkspaceEntry;
 * knows nothing about components or ad-hoc routes.
 */
export function producerOf(flag: WorkflowFlag): WorkspaceEntry | undefined {
  return WORKSPACE_REGISTRY.find((entry) => entry.produces === flag)
}
