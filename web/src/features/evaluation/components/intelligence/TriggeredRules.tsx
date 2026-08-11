import type { TriggeredRuleWire } from '@/shared/contracts/analysis-report'

/**
 * TriggeredRules — the "why" of the verdict: how many rules fired and which
 * ones, as chips showing rule id + priority. `priority` is the KB agenda
 * firing priority (rule.priority) — labeled "priority", NEVER "weight" (the
 * wire carries no fuzzy activation degree).
 */
export function TriggeredRules({ rules }: { rules: TriggeredRuleWire[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">Triggered Rules</h3>
      <p data-testid="assessment-rule-count" className="text-[11px] text-muted-foreground">
        {rules.length} rule{rules.length === 1 ? '' : 's'} triggered
      </p>
      <ul className="flex flex-wrap gap-1.5" data-testid="assessment-triggered-rules">
        {rules.map((rule) => (
          <li
            key={rule.id}
            data-testid="assessment-rule"
            className="rounded border border-border bg-secondary/10 px-2 py-0.5 text-[10px] font-mono"
          >
            {rule.id}
            <span className="text-muted-foreground"> · priority {rule.priority}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
