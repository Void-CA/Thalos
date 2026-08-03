import { createElement, type ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { AnalysisWorkspace } from '@/features/analysis/workspace'
import { ExecutionWorkspace } from '@/features/execution/execution-workspace'
import { KnowledgeWorkspace } from '@/features/knowledge/workspace'
import { PlanningWorkspace } from '@/features/planning/workspace'
import { RobotShell } from '@/features/robots/workspace'
import { SemanticWorkspace } from '@/features/semantic/semantic-workspace'
import { SessionsWorkspace } from '@/features/sessions/workspace'
import { AppShell } from '@/shared/layout/app-shell'
import { GuardedRoute } from '@/shared/workflow/guarded-route'
import { WORKSPACE_REGISTRY, type WorkspaceName } from '@/shared/workflow/registry'

/**
 * View registry — maps each registered workspace to its view component.
 * Kept separate from the navigation registry (design: VIEW_REGISTRY).
 */
export const VIEW_REGISTRY: Record<WorkspaceName, ComponentType> = {
  robot: RobotShell,
  task: SemanticWorkspace,
  planning: PlanningWorkspace,
  analysis: AnalysisWorkspace,
  execution: ExecutionWorkspace,
  sessions: SessionsWorkspace,
  knowledge: KnowledgeWorkspace,
}

/**
 * Route config derived from WORKSPACE_REGISTRY: every registered workspace gets
 * exactly one route under the AppShell layout route. Hidden workspaces
 * (sessions/knowledge) therefore render their placeholder instead of 404ing,
 * and the registry stays the single source of truth for navigation.
 *
 * Every workspace element is wrapped in a GuardedRoute that consults the same
 * registry: when the workspace's `requires` flags are unmet, the guard
 * redirects to the producer of the first missing flag instead of rendering.
 */
export const routerConfig: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: WORKSPACE_REGISTRY.map((entry) => {
      const element = (
        <GuardedRoute workspace={entry.workspace}>
          {createElement(VIEW_REGISTRY[entry.workspace])}
        </GuardedRoute>
      )
      return entry.path === '/'
        ? { index: true, element }
        : { path: entry.path.slice(1), element }
    }),
  },
]

export const router = createBrowserRouter(routerConfig)
