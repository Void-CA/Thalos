import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { requirementReason } from '@/shared/workflow/derive'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import type { WorkflowState, WorkspaceEntry } from '@/shared/workflow/types'
import { buttonVariants } from '@/components/ui/button'

/**
 * TopBar — navigation derived from WORKSPACE_REGISTRY.
 * Hidden entries (sessions/knowledge) render no nav link until their content
 * is delivered. The URL is the single source of truth for the active workspace.
 *
 * Links are grouped by `kind`: pipeline stage links first (kind default
 * 'stage'), a decorative divider, then auxiliary tool links (kind 'tool').
 * The Demos workspace (showcase-scenarios D5) is the current tool entry — it
 * renders after the divider. The divider is aria-hidden: it is purely visual,
 * the links carry the accessible names.
 *
 * Links reflect guard state (slice 5): when a workspace's `requires` flags are
 * unmet the link is aria-disabled and its click is prevented — the same
 * registry + WorkflowState contract the GuardedRoute enforces, so navigation
 * surfaces never contradict the guards.
 */
export function TopBar() {
  const flags = useWorkflowState()
  const stageLinks = WORKSPACE_REGISTRY.filter(
    (entry) => !entry.hidden && (entry.kind ?? 'stage') === 'stage',
  )
  const toolLinks = WORKSPACE_REGISTRY.filter((entry) => !entry.hidden && entry.kind === 'tool')

  return (
    <header className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-sidebar shrink-0">
      {/* Logo / Name */}
      <span className="font-bold text-sm tracking-tight mr-4">
        Thalos
      </span>

      {/* Workspace nav links (registry-driven): stages → divider → tools */}
      <nav className="flex items-center gap-0.5">
        {stageLinks.map((entry) => (
          <WorkspaceNavLink key={entry.path} entry={entry} flags={flags} />
        ))}
        {toolLinks.length > 0 && (
          <>
            <span
              data-testid="nav-divider"
              aria-hidden
              className="border-l border-border mx-1 self-stretch min-h-5"
            />
            {toolLinks.map((entry) => (
              <WorkspaceNavLink key={entry.path} entry={entry} flags={flags} />
            ))}
          </>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* Placeholder for future widgets */}
        <span className="text-xs text-muted-foreground">v1.0.0-mvp</span>
      </div>
    </header>
  )
}

/** One registry nav link, reflecting its guard state (aria-disabled when blocked). */
function WorkspaceNavLink({ entry, flags }: { entry: WorkspaceEntry; flags: WorkflowState }) {
  const blocked = requirementReason(entry, flags) !== null
  return (
    <NavLink
      to={entry.path}
      end={entry.path === '/'}
      aria-disabled={blocked || undefined}
      title={requirementReason(entry, flags) ?? undefined}
      onClick={(event) => {
        if (blocked) event.preventDefault()
      }}
      className={({ isActive }) =>
        cn(
          buttonVariants({ variant: isActive ? 'secondary' : 'ghost', size: 'sm' }),
          'h-7 px-2.5 text-xs',
          blocked && 'opacity-40',
        )
      }
    >
      {entry.label}
    </NavLink>
  )
}
