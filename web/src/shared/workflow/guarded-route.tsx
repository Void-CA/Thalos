import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useWorkflowState } from './use-workflow-state'
import { producerOf, WORKSPACE_REGISTRY } from './registry'
import type { WorkspaceName } from './types'

interface GuardedRouteProps {
  /** Workspace this route renders — resolved from the registry, never the URL. */
  workspace: WorkspaceName
  children: ReactNode
}

/**
 * GuardedRoute — declarative route wrapper (design: D4, workflow-guards spec).
 *
 * Reads the workflow flags via `useWorkflowState()`, consults the registry for
 * this workspace's `requires`, and redirects to the workspace that PRODUCES the
 * first missing flag (root landing when no producer exists). Zero business
 * logic: it never interprets what a flag means and never reads stores directly
 * — the registry + WorkflowState decide everything.
 */
export function GuardedRoute({ workspace, children }: GuardedRouteProps) {
  const flags = useWorkflowState()
  const entry = WORKSPACE_REGISTRY.find((e) => e.workspace === workspace)

  // Unreachable in practice: every route derives from WORKSPACE_REGISTRY.
  if (!entry) return children

  const missing = entry.requires.find((flag) => !flags[flag])
  if (missing) {
    return <Navigate to={producerOf(missing)?.path ?? '/'} replace />
  }
  return children
}
