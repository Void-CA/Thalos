import {
  EChart,
  manipulabilityBuilder,
  metricsDashboardBuilder,
  scoreBreakdownBuilder,
} from '@/shared/charts'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * PlanCharts — planning charts as a sibling of AdvisorSection (design P6, S3).
 *
 * Pipeline (design P7): AnalysisReport → Builder → ChartModel → EChart wrapper.
 * The component is a PURE CONSUMER (P2/P3):
 *  - It receives the SAME canonical report the Advisor receives (both are fed
 *    the store's report by PlanningWorkspace — siblings, never one feeding the
 *    other).
 *  - ALL domain mapping happens in the S2 builders; the component only calls
 *    them with the report and renders one EChart per ChartModel. It reads no
 *    report field and computes no domain value.
 *  - Empty states derive from the domain via ChartModel.empty (P4): an absent
 *    series or empty metrics surface the builders' explicit messages — no
 *    component heuristics.
 */
export interface PlanChartsProps {
  report: AnalysisReportWire | null
}

export function PlanCharts({ report }: PlanChartsProps) {
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
        <p className="text-xs">No chart data available</p>
      </div>
    )
  }

  const models = [
    manipulabilityBuilder(report),
    scoreBreakdownBuilder(report),
    metricsDashboardBuilder(report),
  ]

  return (
    <div className="flex flex-col gap-3">
      {models.map((model, index) => (
        <div key={index} className="h-64 w-full">
          <EChart model={model} />
        </div>
      ))}
    </div>
  )
}
