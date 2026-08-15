import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { requirementReason } from '@/shared/workflow/derive'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import type { WorkflowState, WorkspaceEntry } from '@/shared/workflow/types'
import { buttonVariants } from '@/components/ui/button'

/**
 * TopBar — brand + auxiliary tool navigation.
 *
 * Stage navigation lives in the Stepper (WORKSPACE_REGISTRY entries with a
 * `stage` field, 1-6); the TopBar renders ONLY the brand, tool entries
 * (kind 'tool' — Demos today) and the version label. The URL is the single
 * source of truth for the active workspace.
 *
 * Tool links reflect guard state (slice 5): when a workspace's `requires` flags
 * are unmet the link is aria-disabled and its click is prevented — the same
 * registry + WorkflowState contract the GuardedRoute enforces, so navigation
 * surfaces never contradict the guards.
 */
export function TopBar() {
  const flags = useWorkflowState()
  const toolLinks = WORKSPACE_REGISTRY.filter((entry) => !entry.hidden && entry.kind === 'tool')

  return (
    <header className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-sidebar shrink-0">
      {/* Logo / Name */}
      <span className="font-bold text-sm tracking-tight mr-4">
        Thalos
      </span>

      {/* Tool nav links (registry-driven, kind 'tool') — stages live in the Stepper. */}
      <nav className="flex items-center gap-0.5">
        {toolLinks.map((entry) => (
          <WorkspaceNavLink key={entry.path} entry={entry} flags={flags} />
        ))}
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
