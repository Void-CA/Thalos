import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AssessmentTraceEntryWire } from '@/shared/contracts/analysis-report'
import { ruleLabel } from '@/shared/analysis/rules'

/**
 * InferenceTrace — the collapsible detail view of the verdict: the full
 * inference trace (fired rule, agenda priority, bindings, derived output) in
 * firing order, collapsed by default. Redesigned for readability: a clear
 * always-visible "Inference trace" affordance (count + chevron), readable row
 * height, mono ids paired with human labels, and muted-but-contrasting text.
 */
export function InferenceTrace({ trace }: { trace: AssessmentTraceEntryWire[] }) {
  const [traceOpen, setTraceOpen] = useState(false)

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/10 p-3">
      <button
        type="button"
        data-testid="assessment-trace-toggle"
        aria-expanded={traceOpen}
        onClick={() => setTraceOpen((open) => !open)}
        className="flex w-full cursor-pointer items-center gap-2 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${traceOpen ? 'rotate-90' : ''}`}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Inference trace
        </span>
        <span className="text-[10px] text-muted-foreground">
          {trace.length} step{trace.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-[10px] font-medium text-primary">{traceOpen ? 'Hide' : 'Show'}</span>
      </button>
      {traceOpen && (
        <div data-testid="assessment-trace" className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                <th className="border-b border-border px-2 py-1.5 font-semibold">#</th>
                <th className="border-b border-border px-2 py-1.5 font-semibold">Rule</th>
                <th className="border-b border-border px-2 py-1.5 font-semibold">Priority</th>
                <th className="border-b border-border px-2 py-1.5 font-semibold">Bindings</th>
                <th className="border-b border-border px-2 py-1.5 font-semibold">Derived</th>
              </tr>
            </thead>
            <tbody>
              {trace.map((entry, index) => (
                <tr key={`${entry.rule_id}-${index}`} data-testid="assessment-trace-entry" className="align-top">
                  <td className="border-b border-border px-2 py-1.5 text-[11px] text-muted-foreground tabular-nums">
                    {index + 1}
                  </td>
                  <td className="border-b border-border px-2 py-1.5">
                    <span className="font-mono text-[11px] font-semibold text-foreground">{entry.rule_id}</span>
                    <span className="block text-[11px] text-muted-foreground">{ruleLabel(entry.rule_id)}</span>
                  </td>
                  <td className="border-b border-border px-2 py-1.5 text-[11px] text-muted-foreground tabular-nums">
                    {entry.priority}
                  </td>
                  <td className="border-b border-border px-2 py-1.5 font-mono text-[11px] text-foreground/90">
                    {Object.entries(entry.bindings)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(', ')}
                  </td>
                  <td className="border-b border-border px-2 py-1.5 font-mono text-[11px] text-foreground/90">
                    {Object.entries(entry.derived_output)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
