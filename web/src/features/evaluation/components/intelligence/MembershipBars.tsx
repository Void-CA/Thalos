/**
 * MembershipBars — the "evidence" of the verdict: one horizontal bar per
 * evidence variable (manipulability, singularity_proximity,
 * collision_clearance, trajectory_complexity) showing its 0..1 membership
 * value. Values outside 0..1 are clamped to the bar range (negative
 * clearance clamps to 0 width). One bar per evidence KEY actually carried by
 * the wire — no variables are invented.
 */
export function MembershipBars({ evidence }: { evidence: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Evidence</h3>
      <div className="flex flex-col gap-2" data-testid="assessment-evidence">
        {Object.entries(evidence).map(([key, value]) => {
          const pct = Math.min(Math.max(value, 0), 1) * 100
          return (
            <div
              key={key}
              data-testid="assessment-evidence-chip"
              className="flex items-center gap-3 text-xs font-mono tabular-nums"
            >
              <span className="w-48 shrink-0 truncate">
                {key}: {value.toFixed(3)}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary" role="presentation">
                <div
                  data-testid="membership-bar"
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
