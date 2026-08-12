import { useLocation, useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { deriveStepperStages, type StageState } from '@/shared/workflow/derive'

/**
 * Stage state → marker glyph (global-stepper spec visual: ✓ passed, ● current,
 * ○ pending; blocked gets ✕ + the derived reason). aria-hidden: the stage
 * label is the accessible name; state is conveyed via aria-current/disabled
 * and the visible reason text.
 */
const STATE_GLYPH: Record<StageState, string> = {
  passed: '✓',
  current: '●',
  pending: '○',
  blocked: '✕',
}

/**
 * Global workflow stepper (design D1, global-stepper spec — delta MODIFIED).
 *
 * A slim strip below the TopBar, mounted in the layout route OUTSIDE the
 * <Outlet/> — like the viewport, it persists across workspace transitions. It
 * renders the six pipeline stages (Robot → Scene → Programming → Evaluation
 * → Execution → Sessions) as a PROJECTION of the area registry
 * (`deriveStepperStages` orders by the `stage` field — no parallel stage
 * list, criterion C1) and derives each stage's state purely from
 * `useWorkflowState()` (criterion C4 — it never re-derives store flags):
 *
 *   - current  → the active route (aria-current="step")
 *   - blocked  → a requirement is unmet; the stage is disabled and shows the
 *                reason derived from the missing flag (never a fixed string)
 *   - passed   → the stage produced its output / lies before the current one
 *   - pending  → requirements met, not reached yet
 *
 * Availability and navigation are SEPARATE (criterion C3): a blocked stage
 * stays visible with its reason, but its click never changes the area — the
 * guards (GuardedRoute) own navigation decisions, the stepper only reflects
 * progress (R5). Navigation only happens here (registry-derived) and through
 * the router: no in-workspace cross-nav buttons remain.
 */
export function Stepper() {
  const flags = useWorkflowState()
  const location = useLocation()
  const navigate = useNavigate()
  const stages = deriveStepperStages(flags, location.pathname, WORKSPACE_REGISTRY)

  return (
    <nav
      aria-label="Workflow"
      className="flex items-center gap-0.5 px-4 py-1 border-b border-border bg-sidebar text-xs shrink-0 overflow-x-auto"
    >
      {stages.map((stage, index) => {
        const { entry, state, reason } = stage
        const blocked = state === 'blocked'
        const current = state === 'current'
        return (
          <span key={entry.path} className="flex items-center gap-1 whitespace-nowrap">
            {index > 0 && (
              <span aria-hidden className="text-muted-foreground/40 mx-0.5 select-none">
                ›
              </span>
            )}
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                // C3: availability (disabled) and navigation are separate
                // contracts. A blocked stage renders with its reason but its
                // click must NEVER navigate — guard here AND via disabled.
                if (blocked) return
                navigate(entry.path)
              }}
              aria-current={current ? 'step' : undefined}
              title={reason ?? undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium',
                'transition-colors cursor-pointer disabled:cursor-not-allowed',
                current && 'bg-primary-weak text-primary',
                blocked && 'text-muted-foreground line-through',
                !current && !blocked && 'text-foreground/80 hover:bg-accent/30',
              )}
            >
              <span aria-hidden className="text-[10px]">
                {STATE_GLYPH[state]}
              </span>
              {entry.label}
            </button>
            {blocked && reason && (
              <span className="text-[10px] text-destructive">{reason}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
