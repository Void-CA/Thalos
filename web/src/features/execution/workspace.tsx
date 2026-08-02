/**
 * ExecutionWorkspace — placeholder shell (slice 1).
 *
 * The full execution lifecycle (Active Plan, controls, progress) lands in a
 * later slice. Rendered inside the layout <Outlet/>; the viewport persists
 * around it (invariant #1).
 */
export function ExecutionWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Execution
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-sm text-muted-foreground">
          The execution workspace arrives with the lifecycle slice.
        </p>
      </div>
    </div>
  )
}
