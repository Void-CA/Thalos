import { useState } from 'react'
import type { AssessmentTraceEntryWire } from '@/shared/contracts/analysis-report'

/**
 * InferenceTrace — the collapsible detail view of the verdict: the full
 * inference trace (fired rule, agenda priority, bindings, derived output) in
 * firing order, collapsed by default. Reuses the existing table format from
 * the pre-tab IntelligentAssessment section.
 */
export function InferenceTrace({ trace }: { trace: AssessmentTraceEntryWire[] }) {
  const [traceOpen, setTraceOpen] = useState(false)

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-testid="assessment-trace-toggle"
        aria-expanded={traceOpen}
        onClick={() => setTraceOpen((open) => !open)}
        className="inline-flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary hover:underline cursor-pointer"
      >
        {traceOpen ? 'Hide' : 'Show'} Inference Trace
      </button>
      {traceOpen && (
        <div data-testid="assessment-trace" className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px] font-mono">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="border-b border-border px-2 py-1">#</th>
                <th className="border-b border-border px-2 py-1">Rule</th>
                <th className="border-b border-border px-2 py-1">Priority</th>
                <th className="border-b border-border px-2 py-1">Bindings</th>
                <th className="border-b border-border px-2 py-1">Derived</th>
              </tr>
            </thead>
            <tbody>
              {trace.map((entry, index) => (
                <tr key={`${entry.rule_id}-${index}`} data-testid="assessment-trace-entry">
                  <td className="border-b border-border px-2 py-1 text-muted-foreground">{index + 1}</td>
                  <td className="border-b border-border px-2 py-1">{entry.rule_id}</td>
                  <td className="border-b border-border px-2 py-1">{entry.priority}</td>
                  <td className="border-b border-border px-2 py-1">
                    {Object.entries(entry.bindings)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(', ')}
                  </td>
                  <td className="border-b border-border px-2 py-1">
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
