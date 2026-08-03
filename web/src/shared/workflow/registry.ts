import type { WorkflowFlag, WorkspaceEntry } from './types'
export type { Capability, WorkspaceEntry, WorkspaceName } from './types'

/**
 * Single declarative navigation + guard contract (design: WORKSPACE_REGISTRY).
 *
 * Every workspace declares what it `requires` (WorkflowState flags), what it
 * `produces`, and its exclusive `capability` (invariant #7). Routes, guards,
 * stepper and breadcrumbs all derive from this array — no ad-hoc nav rules
 * live anywhere else.
 *
 * NOTE: `/analysis` is a legacy workspace absorbed into `/planning` in slice 6;
 * it stays registered (with a reasonable requires contract) until then.
 */
export const WORKSPACE_REGISTRY: WorkspaceEntry[] = [
  { path: '/', workspace: 'robot', label: 'Robot', requires: [], produces: null, capability: null, hidden: false },
  { path: '/task', workspace: 'task', label: 'Task', requires: ['robotLoaded'], produces: 'compiled', capability: 'compile', hidden: false },
  { path: '/planning', workspace: 'planning', label: 'Planning', requires: ['compiled'], produces: 'analyzed', capability: 'optimize', hidden: false },
  { path: '/analysis', workspace: 'analysis', label: 'Analysis', requires: ['compiled'], produces: null, capability: null, hidden: false },
  { path: '/execution', workspace: 'execution', label: 'Execution', requires: ['executable'], produces: 'completed', capability: 'execute', hidden: false },
  { path: '/sessions', workspace: 'sessions', label: 'Sessions', requires: ['completed'], produces: null, capability: 'replay', hidden: true },
  { path: '/knowledge', workspace: 'knowledge', label: 'Knowledge', requires: ['analyzed'], produces: null, capability: 'explain', hidden: true },
]

/**
 * Find the workspace that produces a given flag — used by guard redirects
 * (design: producerOf). Fully declarative: maps WorkflowFlag → WorkspaceEntry;
 * knows nothing about components or ad-hoc routes.
 */
export function producerOf(flag: WorkflowFlag): WorkspaceEntry | undefined {
  return WORKSPACE_REGISTRY.find((entry) => entry.produces === flag)
}
