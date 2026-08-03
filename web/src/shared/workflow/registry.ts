export type WorkspaceName =
  | 'robot'
  | 'task'
  | 'planning'
  | 'analysis'
  | 'execution'
  | 'sessions'
  | 'knowledge'

export interface WorkspaceEntry {
  /** Router path for this workspace ('/' for the landing). */
  path: string
  /** Stable workspace identifier — key for the view registry. */
  workspace: WorkspaceName
  /** Human-readable nav label. */
  label: string
  /** True while the workspace has no delivered content yet (nav link suppressed). */
  hidden: boolean
}

/**
 * Single declarative navigation contract (design: WORKSPACE_REGISTRY).
 *
 * Slice 1 carries path/workspace/label/hidden only; `requires`/`produces`/
 * `capability` arrive with the workflow-state slice. Routes are derived from
 * this array in `router.tsx`, so every registered workspace renders (hidden
 * ones included) and none can 404 by construction.
 */
export const WORKSPACE_REGISTRY: WorkspaceEntry[] = [
  { path: '/', workspace: 'robot', label: 'Robot', hidden: false },
  { path: '/task', workspace: 'task', label: 'Task', hidden: false },
  { path: '/planning', workspace: 'planning', label: 'Planning', hidden: false },
  { path: '/analysis', workspace: 'analysis', label: 'Analysis', hidden: false },
  { path: '/execution', workspace: 'execution', label: 'Execution', hidden: false },
  { path: '/sessions', workspace: 'sessions', label: 'Sessions', hidden: true },
  { path: '/knowledge', workspace: 'knowledge', label: 'Knowledge', hidden: true },
]
