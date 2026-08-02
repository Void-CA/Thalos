import { useWorkflowState } from '@/shared/workflow/use-workflow-state'
import { deriveStatusMessage } from '@/shared/workflow/derive'

/**
 * StatusBar — surfaces the REAL workflow state (S2), derived from the flags via
 * the pure `deriveStatusMessage()`. Never a hardcoded string: the line changes
 * with the actual state (robot → task → compile → run → complete).
 */
export function StatusBar() {
  const flags = useWorkflowState()

  return (
    <footer className="flex items-center justify-between px-4 py-0.5 border-t border-border bg-sidebar text-xs text-muted-foreground shrink-0">
      <span>{deriveStatusMessage(flags)}</span>
      <span>Thalos Robotics</span>
    </footer>
  )
}
