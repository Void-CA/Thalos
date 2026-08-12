import type { TriggeredRuleWire } from '@/shared/contracts/analysis-report'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  isPositiveRule,
  ruleLabel,
} from '@/shared/analysis/rules'
import { humanizeKey } from '@/shared/analysis/evidence'

interface RuleGroup {
  category: string
  label: string
  rules: TriggeredRuleWire[]
}

/** Group fired rules by category in a fixed display order; unknown categories
 *  append after (each its own group). Keeps every wire category readable. */
function groupedRules(rules: TriggeredRuleWire[]): RuleGroup[] {
  const groups: RuleGroup[] = []
  for (const category of CATEGORY_ORDER) {
    const members = rules.filter((rule) => rule.category === category)
    if (members.length > 0) {
      groups.push({ category, label: CATEGORY_LABELS[category], rules: members })
    }
  }
  const unknownCategories = [...new Set(rules.map((r) => r.category).filter((c) => !CATEGORY_ORDER.includes(c)))]
  for (const category of unknownCategories) {
    groups.push({
      category,
      label: humanizeKey(category),
      rules: rules.filter((r) => r.category === category),
    })
  }
  return groups
}

/** Problem-rule chips carry the warning tone; safe/positive rules read with a
 *  success tone so a "Safe plan" is never presented as a warning. */
const CHIP_TONES = {
  positive: 'border-success-mid/60 bg-success-weak text-chart-3',
  problem: 'border-warning-mid bg-warning-weak text-chart-4',
}

/**
 * TriggeredRules — the "why" of the verdict, presented for a casual user:
 * rules grouped by reasoning category, each chip a HUMAN label (raw ids only
 * as the hover traceability anchor). `priority` stays but de-emphasized as a
 * small muted detail — it is the KB agenda firing priority, never a fuzzy
 * weight (the wire carries no fuzzy activation degree).
 */
export function TriggeredRules({ rules }: { rules: TriggeredRuleWire[] }) {
  const groups = groupedRules(rules)

  return (
    <div className="flex flex-col gap-2" data-testid="assessment-triggered-rules">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Triggered Rules
        </h3>
        <p data-testid="assessment-rule-count" className="text-xs text-muted-foreground">
          {rules.length} rule{rules.length === 1 ? '' : 's'}
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.category} className="flex flex-col gap-1.5" data-testid="assessment-rule-group">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h4>
          <ul className="flex flex-wrap gap-2">
            {group.rules.map((rule) => (
              <li
                key={rule.id}
                data-testid="assessment-rule"
                title={rule.id}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${isPositiveRule(rule.id) ? CHIP_TONES.positive : CHIP_TONES.problem}`}
              >
                {ruleLabel(rule.id)}
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  priority {rule.priority}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
