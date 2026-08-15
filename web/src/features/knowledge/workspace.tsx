/**
 * KnowledgeWorkspace — placeholder shell (slice 1, hidden route).
 *
 * Registers the `/knowledge` route so direct URL entry never 404s; the nav link
 * stays hidden until the knowledge content is delivered in a later change.
 */
export function KnowledgeWorkspace() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-border/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Knowledge
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-sm text-muted-foreground">
          The knowledge workspace arrives with a later change.
        </p>
      </div>
    </div>
  )
}
