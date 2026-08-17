import { createElement, type ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { ConfigurationWorkspace } from '@/features/configuration/workspace'
import { DemosWorkspace } from '@/features/demos/workspace'
import { EvaluationWorkspace } from '@/features/evaluation/workspace'
import { ExecutionWorkspace } from '@/features/execution/execution-workspace'
import { KnowledgeWorkspace } from '@/features/knowledge/workspace'
import { ProgrammingWorkspace } from '@/features/programming/workspace'
import { RobotShell } from '@/features/robots/workspace'
import { SceneWorkspace } from '@/features/scene/SceneWorkspace'
import { SessionsWorkspace } from '@/features/sessions/workspace'
import { AppShell } from '@/shared/layout/app-shell'
import { GuardedRoute } from '@/shared/workflow/guarded-route'
import { WORKSPACE_REGISTRY, type WorkspaceName } from '@/shared/workflow/registry'

/**
 * View registry — maps each registered workspace to its view component.
 * Kept separate from the navigation registry (design: VIEW_REGISTRY).
 *
 * P0-B (workspace-spatial-layout): the `analysis` workspace was REMOVED from
 * the registry — Workspace Analysis is no longer a route. It renders inside
 * the Robot view as a tools-accordion entry (TOOLS_BY_PERSPECTIVE.robot in
 * features/viewport/components/tools-registry). `scene` renders the Escena
 * area (features/scene/SceneWorkspace) — the exclusive owner of the Scene
 * editor since S2; /task renders zero Scene UI. Hotfix (unify-programming):
 * `task` maps to ProgrammingWorkspace — /task AND the old /planning content
 * live in one area (Task / Motion / Code tabs). Hotfix (evaluation-workspace):
 * `evaluation` maps to EvaluationWorkspace — the pre-execution EVALUACIÓN view
 * at /evaluation (stage 4); the analysis TAB left the programming workspace.
 */
export const VIEW_REGISTRY: Record<WorkspaceName, ComponentType> = {
  robot: RobotShell,
  scene: SceneWorkspace,
  task: ProgrammingWorkspace,
  evaluation: EvaluationWorkspace,
  execution: ExecutionWorkspace,
  sessions: SessionsWorkspace,
  knowledge: KnowledgeWorkspace,
  configuration: ConfigurationWorkspace,
  demos: DemosWorkspace,
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
