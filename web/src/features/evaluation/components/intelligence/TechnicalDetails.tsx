import { ChevronDown } from 'lucide-react'
import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'
import { RuleReasoning } from './RuleReasoning'
import { MembershipBars } from './MembershipBars'

/**
 * TechnicalDetails (structural UX redesign) — ONE collapsible section that
 * owns ALL the technical detail of the verdict (rule reasoning + evidence
 * table), CLOSED by default: these are support material, not the decision. A
 * native `<details>` keeps the semantic closed-by-default state. The count
 * hint ("· N rules · N evidence") makes the section scannable before opening.
 * Two clean tables with ZERO duplication: RuleReasoning carries the rules
 * (label, agenda priority, why, produced) and MembershipBars the evidence —
 * the inference trace table was redundant with RuleReasoning and was removed
 * (its raw `key=value` strings duplicated what the reasoning table already
 * humanizes). The children keep their own testids (`rule-reasoning*`,
 * `assessment-evidence*`). All copy is English.
 */
export function TechnicalDetails({
  rules,
  evidence,
  trace,
}: {
  rules: TriggeredRuleWire[]
  evidence: Record<string, number>
  trace: AssessmentTraceEntryWire[]
}) {
  const ruleCount = rules.length
  const evidenceCount = Object.keys(evidence).length

  return (
    <details
      data-testid="technical-details"
      className="group rounded-lg border border-border bg-secondary/10 p-3"
    >
      <summary
        data-testid="technical-details-toggle"
        className="flex cursor-pointer select-none list-none items-center gap-2 text-left [&::-webkit-details-marker]:hidden"
      >
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Technical details
        </span>
        <span className="text-[10px] text-muted-foreground">
          · {ruleCount} rule{ruleCount === 1 ? '' : 's'} · {evidenceCount} evidence
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3" data-testid="technical-details-body">
        <RuleReasoning rules={rules} trace={trace} />
        <MembershipBars evidence={evidence} />
      </div>
    </details>
  )
}
