/**
 * Trace chart builder — pure function, spec trace-chart.
 *
 * Input: canonical `MotionTraceWire` from GET /sessions/{id}/trace (never a
 * /sessions list row, never a hand-built shape — I1). Output: ChartModel. NO
 * ECharts, NO React, NO DOM (O2).
 *
 * Projects a multi-series line chart: ONE line per joint (positions verbatim),
 * X axis = time. The frozen ChartModel contract (S2) maps X to the array
 * index, so the temporal position is carried by the category labels formatted
 * mm:ss — the exact pattern the S6 timeline builder uses for its time axis.
 *
 * Invariant I2 (no metric computation): the builder projects ONLY
 * `sample.joints` (rad). It NEVER computes RMSE or tracking error against
 * `target_joints`, never differentiates `velocities`, and never synthesizes
 * intermediate samples across a gap — every series point is one canonical
 * sample, so a time gap stays visible on the axis labels.
 */

import type { MotionTraceWire } from '@/features/sessions/api/session-api'
import type { ChartModel } from '../types'

/** Seconds → mm:ss ("65" → "1:05"). Presentation only (spec time formatting). */
function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

/** Joint index → theme color token; cycles --chart-1..4 (design joint cycling). */
function jointColor(index: number): string {
  return `chart-${(index % 4) + 1}`
}

/**
 * Projects the canonical trace into one line series per joint. The number of
 * series equals `joints.length` of the first sample; each series has exactly
 * `samples.length` points — nothing is added, interpolated or derived.
 */
export function traceBuilder(trace: MotionTraceWire): ChartModel {
  const samples = trace.samples
  if (samples.length === 0) {
    return { series: [], xAxis: [], empty: { message: 'No trace data' } }
  }

  const jointCount = samples[0].joints.length

  return {
    title: 'Joint positions',
    series: Array.from({ length: jointCount }, (_, jointIndex) => ({
      name: `Joint ${jointIndex + 1}`,
      type: 'line' as const,
      // Canonical joint positions verbatim — one point per sample (I2).
      data: samples.map((s) => s.joints[jointIndex]),
      color: jointColor(jointIndex),
      hideSymbol: true,
    })),
    xAxis: [
      {
        type: 'category',
        name: 'Time',
        categories: samples.map((s) => formatTime(s.timestamp)),
      },
    ],
    yAxis: [{ type: 'value', name: 'Position (rad)' }],
    legend: { show: true, position: 'bottom' },
    tooltip: { trigger: 'axis' },
  }
}
