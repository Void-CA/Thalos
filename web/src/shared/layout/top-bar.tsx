import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { buttonVariants } from '@/components/ui/button'

/**
 * TopBar — navigation derived from WORKSPACE_REGISTRY.
 * Hidden entries (sessions/knowledge) render no nav link until their content
 * is delivered. The URL is the single source of truth for the active workspace.
 */
export function TopBar() {
  const links = WORKSPACE_REGISTRY.filter((entry) => !entry.hidden)

  return (
    <header className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-sidebar shrink-0">
      {/* Logo / Name */}
      <span className="font-bold text-sm tracking-tight mr-4">
        Thalos
      </span>

      {/* Workspace nav links (registry-driven) */}
      <nav className="flex items-center gap-0.5">
        {links.map((entry) => (
          <NavLink
            key={entry.path}
            to={entry.path}
            end={entry.path === '/'}
            className={({ isActive }) =>
              cn(
                buttonVariants({ variant: isActive ? 'secondary' : 'ghost', size: 'sm' }),
                'h-7 px-2.5 text-xs',
              )
            }
          >
            {entry.label}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* Placeholder for future widgets */}
        <span className="text-xs text-muted-foreground">v0.1.0</span>
      </div>
    </header>
  )
}
