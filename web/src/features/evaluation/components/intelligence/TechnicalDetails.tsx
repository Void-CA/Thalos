import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'
import { RuleReasoning } from './RuleReasoning'
import { MembershipBars } from './MembershipBars'

/**
 * TechnicalDetails — the inference AUDIT, always visible (no collapsible): the
 * Intelligence tab is pure assessment now that the Advisor lives in its own
 * Repairs tab, so the reasoning no longer needs to hide. Section labels make
 * the audit obvious: "Inference · rule firing order · derived facts"
 * (RuleReasoning) and "Evidence · fuzzification inputs" (MembershipBars). All
 * copy is English.
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
    <section
      data-testid="technical-details"
      className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/10 p-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
        Inference trace
        <span className="ml-2 text-[10px] font-normal normal-case text-muted-foreground">
          · {ruleCount} rule{ruleCount === 1 ? '' : 's'} · {evidenceCount} evidence
        </span>
      </h3>
      <div className="flex flex-col gap-3" data-testid="technical-details-body">
        <div className="flex flex-col gap-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Inference · rule firing order · derived facts
          </h4>
          <RuleReasoning rules={rules} trace={trace} />
        </div>
        <MembershipBars evidence={evidence} />
      </div>
    </section>
  )
}
