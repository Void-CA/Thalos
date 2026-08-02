/**
 * SessionsWorkspace — placeholder shell (slice 1, hidden route).
 *
 * Registers the `/sessions` route so direct URL entry never 404s; the nav link
 * stays hidden until the sessions content is delivered in a later change.
 */
export function SessionsWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Sessions
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-sm text-muted-foreground">
          The sessions workspace arrives with a later change.
        </p>
      </div>
    </div>
  )
}
