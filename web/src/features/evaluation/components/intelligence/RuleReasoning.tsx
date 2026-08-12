import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'
import {
  CATEGORY_LABELS,
  bindingEntries,
  consequentPhrase,
  ruleLabel,
  type BindingEntry,
} from '@/shared/analysis/rules'
import { humanizeKey } from '@/shared/analysis/evidence'

interface ReasoningRow {
  ruleId: string
  category: string
  label: string
  priority: number | null
  why: BindingEntry[]
  produced: string
}

/** Merge fired rules with their trace entries: trace order first (the real
 *  firing order, carrying the bindings + derived output + agenda priority),
 *  then any rule without a trace entry (defensive) in rules order, rendered
 *  with "—" for why/produced. Priority prefers the trace entry's value (the
 *  authoritative agenda step), falling back to the rule's.
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
      priority: entry.priority ?? null,
      why: bindingEntries(entry.bindings),
      produced: consequentPhrase(entry.derived_output),
    })
  }
  for (const rule of rules) {
    if (seen.has(rule.id)) continue
    rows.push({
      ruleId: rule.id,
      category: rule.category,
      label: ruleLabel(rule.id),
      priority: rule.priority ?? null,
      why: [],
      produced: '—',
    })
  }
  return rows
}

/**
 * RuleReasoning — the audit trail of the expert system, one row per fired rule:
 * the human label, its agenda PRIORITY (merged from the inference trace), WHY
 * it fired (its matched bindings, each with the membership degree) and WHAT it
 * produced (derived facts / evidence marks). This is the only rule information
 * the rest of the tab does NOT already show — the raw chips above it repeated
 * the evidence bars, so they were replaced with this reasoning view. An audit
 * log reads as a TABLE, not cards: a dense `w-full` table (Rule / Priority /
 * Why / Produced) uses the horizontal space, with `table-fixed` widths and an
 * `overflow-x-auto` wrapper so it scrolls on narrow screens. Category reads as
 * a subtle tag under the label, never the loud badge that could not be read.
 * The trace's `priority` is displayed here (not in a separate trace table) —
 * its raw `key=value` bindings duplicated what this table already humanizes.
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
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[26%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Rule
              </th>
              <th
                scope="col"
                className="w-[12%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Priority
              </th>
              <th
                scope="col"
                className="w-[36%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Why
              </th>
              <th
                scope="col"
                className="w-[26%] border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Produced
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.ruleId}
                data-testid="rule-reasoning-row"
                className={index < rows.length - 1 ? 'border-b border-border' : ''}
              >
                <td className="px-3 py-2 align-top">
                  <p className="text-sm font-medium text-foreground">{row.label}</p>
                  {row.category !== '' && (
                    <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {CATEGORY_LABELS[row.category] ?? humanizeKey(row.category)}
                    </p>
                  )}
                </td>
                <td data-testid="rule-priority" className="px-3 py-2 align-top">
                  {row.priority === null ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {row.priority}
                    </p>
                  )}
                </td>
                <td data-testid="rule-why" className="px-3 py-2 align-top">
                  {row.why.length === 0 ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">—</p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {row.why.map((entry, entryIndex) => (
                        <p
                          key={entryIndex}
                          className="text-xs leading-relaxed text-muted-foreground"
                        >
                          {entry.phrase}
                          {entry.degree !== null && (
                            <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">
                              · {entry.degree}
                            </span>
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                </td>
                <td
                  data-testid="rule-produced"
                  className="px-3 py-2 align-top text-sm leading-relaxed text-muted-foreground"
                >
                  {row.produced}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
