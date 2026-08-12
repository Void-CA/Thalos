import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'
import {
  CATEGORY_LABELS,
  bindingPhrase,
  consequentPhrase,
  ruleLabel,
} from '@/shared/analysis/rules'
import { humanizeKey } from '@/shared/analysis/evidence'

interface ReasoningRow {
  ruleId: string
  category: string
  label: string
  why: string
  produced: string
}

/** Merge fired rules with their trace entries: trace order first (the real
 *  firing order, carrying the bindings + derived output), then any rule without
 *  a trace entry (defensive) in rules order, rendered with "—" for why/produced.
 */
function buildRows(
  rules: TriggeredRuleWire[],
  trace: AssessmentTraceEntryWire[],
): ReasoningRow[] {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))
  const seen = new Set<string>()
  const rows: ReasoningRow[] = []

  for (const entry of trace) {
    seen.add(entry.rule_id)
    rows.push({
      ruleId: entry.rule_id,
      category: ruleById.get(entry.rule_id)?.category ?? '',
      label: ruleLabel(entry.rule_id),
      why: bindingPhrase(entry.bindings),
      produced: consequentPhrase(entry.derived_output),
    })
  }
  for (const rule of rules) {
    if (seen.has(rule.id)) continue
    rows.push({
      ruleId: rule.id,
      category: rule.category,
      label: ruleLabel(rule.id),
      why: '—',
      produced: '—',
    })
  }
  return rows
}

/**
 * RuleReasoning — the audit trail of the expert system, one row per fired rule:
 * the human label, WHY it fired (its matched bindings) and WHAT it produced
 * (derived facts / evidence marks). This is the only rule information the rest
 * of the tab does NOT already show — the raw chips above it repeated the
 * evidence bars, so they were replaced with this reasoning view. Category reads
 * as a subtle tag, never the loud badge that could not be read.
 */
export function RuleReasoning({
  rules,
  trace,
}: {
  rules: TriggeredRuleWire[]
  trace: AssessmentTraceEntryWire[]
}) {
  const rows = buildRows(rules, trace)

  return (
    <div className="flex flex-col gap-2" data-testid="rule-reasoning">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Triggered Rules
        </h3>
        <p data-testid="assessment-rule-count" className="text-xs text-muted-foreground">
          {rows.length} rule{rows.length === 1 ? '' : 's'}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.ruleId}
            data-testid="rule-reasoning-row"
            className="rounded-lg border border-border bg-secondary/10 px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{row.label}</span>
              {row.category !== '' && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[row.category] ?? humanizeKey(row.category)}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              <p data-testid="rule-why" className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground/70">Why:</span> {row.why}
              </p>
              <p
                data-testid="rule-produced"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                <span className="font-semibold text-foreground/70">Produced:</span> {row.produced}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
