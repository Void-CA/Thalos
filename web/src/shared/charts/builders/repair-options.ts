/**
 * Repair options builder — pure function, spec alternatives-panel-react.
 *
 * Input: canonical `RepairOptionsWire` from `POST /plan/repair/options`.
 * Output: a card presentation model. NO ECharts, NO React, NO DOM (O2).
 *
 * Criterion C3: the AlternativesPanel is a PURE CONSUMER — every presentation
 * transformation lives here: kebab-case strategy → display label, improvement
 * fraction → signed percent label, metric decimals → display strings. The
 * component renders the view verbatim.
 *
 * Criterion C4: the empty state derives from the DOMAIN. `repairs = []` means
 * the backend found no repair options for this plan — the builder surfaces
 * `empty.message` exactly like ChartModel.empty does for charts; the component
 * never guesses.
 */

import type { ChartEmptyState } from '../types'
import type { RepairMetricsSummaryWire, RepairOptionsWire } from '@/shared/contracts/repair-options'

/** Metric values formatted for display (3 decimals, verbatim rounding). */
export interface RepairMetricsView {
  manipulability: string
  smoothness: string
}

/** One render-ready option card. Every field is display-ready. */
export interface RepairOptionCardView {
  regionId: number
  /** Display label ("Lift Tcp" from "lift-tcp") — cosmetic only. */
  strategy: string
  /** Status verbatim from the wire ("available", …). */
  status: string
  /** Improvement fraction verbatim (sign drives the card accent color). */
  improvement: number
  /** Signed percent label ("+15.0%"). */
  improvementLabel: string
  metricsBefore: RepairMetricsView | null
  metricsAfter: RepairMetricsView | null
}

/** Presentation model of the panel — the wire projected for cards. */
export interface RepairOptionsModel {
  options: RepairOptionCardView[]
  empty: ChartEmptyState | null
}

/** kebab-case strategy key → display label ("split-segment" → "Split Segment"). */
function strategyLabel(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Improvement fraction → signed percent label ("+15.0%", "-5.0%", "+0.0%"). */
function formatImprovement(improvement: number): string {
  const pct = improvement * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function formatMetrics(metrics: RepairMetricsSummaryWire): RepairMetricsView {
  return {
    manipulability: metrics.manipulability.toFixed(3),
    smoothness: metrics.smoothness.toFixed(3),
  }
}

/**
 * Maps the canonical response to the card model. When the domain has no repair
 * options (`repairs = []`) it returns an explicit `empty` state — the panel
 * renders the message, it never invents one.
 */
export function repairOptionsBuilder(response: RepairOptionsWire): RepairOptionsModel {
  if (response.repairs.length === 0) {
    return { options: [], empty: { message: 'No alternatives available' } }
  }

  return {
    options: response.repairs.map((repair) => ({
      regionId: repair.region_id,
      strategy: strategyLabel(repair.strategy),
      status: repair.status,
      improvement: repair.improvement,
      improvementLabel: formatImprovement(repair.improvement),
      metricsBefore: repair.metrics_before === null ? null : formatMetrics(repair.metrics_before),
      metricsAfter: repair.metrics_after === null ? null : formatMetrics(repair.metrics_after),
    })),
    empty: null,
  }
}
