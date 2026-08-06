// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import * as echarts from 'echarts/core'
import { PlanCharts } from './PlanCharts'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import { manipulabilityBuilder as realManipBuilder } from '@/shared/charts/builders/manipulability'
import {
  metricsDashboardBuilder as realMetricsBuilder,
  scoreBreakdownBuilder as realScoreBuilder,
} from '@/shared/charts/builders/metrics-dashboard'
import { installCanvasMock } from '@/test/canvas-mock'
import {
  manipulabilityBuilder,
  scoreBreakdownBuilder,
  metricsDashboardBuilder,
} from '@/shared/charts'

/**
 * S3 — PlanCharts (spec manipulability-chart + metrics-dashboard).
 *
 * The component is a PURE CONSUMER sibling of AdvisorSection (P3): it receives
 * the canonical report via props, delegates EVERY domain mapping to the S2
 * builders, and renders one EChart per ChartModel. Invariants under test:
 *  - I1/P2: the component transforms nothing — the builders are called with the
 *    exact report reference and the rendered charts equal the builder outputs.
 *  - P4: empty states derive from ChartModel.empty (series [] → message,
 *    metrics {} → placeholder), never from component heuristics.
 *  - Full series: N waypoints in, N points on the rendered line + dataZoom
 *    slider/inside + severity colors (spec manipulability-chart).
 *
 * Builders are wrapped in delegating mocks (vi.mock of the barrel) so the
 * purity test can assert the call contract without changing behavior; the
 * rendered output is compared against the REAL builder modules.
 */

vi.mock('@/shared/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/charts')>()
  return {
    ...actual,
    manipulabilityBuilder: vi.fn(actual.manipulabilityBuilder),
    scoreBreakdownBuilder: vi.fn(actual.scoreBreakdownBuilder),
    metricsDashboardBuilder: vi.fn(actual.metricsDashboardBuilder),
  }
})

const manipBuilderMock = vi.mocked(manipulabilityBuilder)
const scoreBuilderMock = vi.mocked(scoreBreakdownBuilder)
const metricsBuilderMock = vi.mocked(metricsDashboardBuilder)

/** Canonical report with a 3-waypoint manipulability series and populated
 *  metrics — exercises the happy path of all three charts (S3.1 fixture). */
function baseReport(overrides: Partial<AnalysisReportWire> = {}): AnalysisReportWire {
  return {
    artifact: { kind: 'MotionPlan', id: 'plan-1' },
    observations: [
      {
        id: 1,
        kind: 'CollisionRisk',
        severity: 'Error',
        artifact: { kind: 'MotionPlan', id: 'plan-1' },
        location: { Waypoint: 1 },
        attributes: {},
        causes: [],
        related: [],
      },
    ],
    actions: [],
    metrics: { waypoint_count: 3 },
    summary: {
      quality_index: 0.71,
      score: 71,
      grade: 'Fair',
      observation_count: 1,
      severity_distribution: { Error: 1, Warning: 1 },
    },
    manipulability_series: [
      { waypoint: 0, yoshikawa: 0.2 },
      { waypoint: 1, yoshikawa: 0.05 },
      { waypoint: 2, yoshikawa: 0.3 },
    ],
    ...overrides,
  }
}

/** Shape the rendered ECharts option is asserted against (subset of the real
 *  option — ECharts merges many defaults). */
interface RenderedSeries {
  type?: string
  data: Array<number | { value: number | [number, number]; itemStyle?: { color?: string } }>
}
interface RenderedOption {
  series: RenderedSeries[]
  dataZoom?: Array<{ type: string }>
  xAxis?: Array<{ name?: string; min?: number; max?: number }>
  yAxis?: Array<{ max?: number }>
}

function optionOf(el: HTMLElement): RenderedOption {
  const chart = echarts.getInstanceByDom(el)
  if (chart === undefined) throw new Error('no echarts instance on element')
  return chart.getOption() as unknown as RenderedOption
}

/** ChartModel data may be wrapped as {value, itemStyle} (dataColors path) or
 *  plain numbers — normalize to the numeric Y values. A wrapped value may also
 *  be an explicit [x, y] pair (temporal axis), unwrapped to its y component. */
function valuesOf(option: RenderedOption, seriesIndex = 0): number[] {
  return option.series[seriesIndex].data.map((point) => {
    if (typeof point !== 'object') return point
    return Array.isArray(point.value) ? point.value[1] : point.value
  })
}

/** The lazy ECharts chunk resolves and mount effects run outside act(); one
 *  act-flushed tick guarantees every mountChart effect has executed. */
async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  installCanvasMock()
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('PlanCharts — planning charts as siblings of AdvisorSection (S3)', () => {
  it('renders three charts from a canonical report: manipulability, score, metrics', async () => {
    render(<PlanCharts report={baseReport()} />)
    // The lazy ECharts chunk resolves asynchronously (React.lazy + dynamic
    // import). Under full-parallel vitest (16 workers) the cold echarts
    // transform can exceed testing-library's 1000ms default wait window — the
    // explicit 5s timeout makes this wait deterministic under load (C2
    // remediation: ECharts must stay in the lazy chunk).
    const els = await screen.findAllByTestId('chart', {}, { timeout: 5000 })
    expect(els).toHaveLength(3)
    await flushEffects()

    // Manipulability — line, N waypoints in → N points out (spec full series),
    // value axis spanning [0, N-1], dataZoom slider + inside. Y values are the
    // -log10 transform (hotfix: linear scale flattened real 6-order variation).
    const manip = optionOf(els[0])
    const yoshikawaExpected = [-Math.log10(0.2), -Math.log10(0.05), -Math.log10(0.3)]
    valuesOf(manip).forEach((value, index) =>
      expect(value).toBeCloseTo(yoshikawaExpected[index], 10),
    )
    expect(manip.series[0].type).toBe('line')
    expect(manip.xAxis?.[0]).toMatchObject({ name: 'Waypoint', min: 0, max: 2 })
    const zooms = (manip.dataZoom ?? []).map((z) => z.type)
    expect(zooms).toContain('slider')
    expect(zooms).toContain('inside')

    // Score breakdown — 0-100 readout bar verbatim (spec score rendered).
    const score = optionOf(els[1])
    expect(valuesOf(score)).toEqual([71])
    expect(score.yAxis?.[0]?.max).toBe(100)

    // Metrics dashboard — severity distribution verbatim, never re-aggregated.
    const metrics = optionOf(els[2])
    expect(valuesOf(metrics)).toEqual([1, 1, 0])
  })

  it('colors manipulability points by observation severity (Error waypoint differs)', async () => {
    render(<PlanCharts report={baseReport()} />)
    const els = await screen.findAllByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()

    const data = optionOf(els[0]).series[0].data
    const color = (index: number) => {
      const point = data[index]
      if (typeof point === 'number') throw new Error('expected object data (dataColors)')
      return point.itemStyle?.color
    }
    // wp1 carries an Error observation → manip.low; wp0/wp2 → manip.high.
    expect(color(1)).toBeTruthy()
    expect(color(1)).not.toBe(color(0))
    expect(color(2)).toBe(color(0))
  })

  it('derives the empty state from ChartModel.empty when the series is empty (P4)', async () => {
    render(<PlanCharts report={baseReport({ manipulability_series: [] })} />)
    const charts = await screen.findAllByTestId('chart', {}, { timeout: 5000 })
    expect(charts).toHaveLength(2)
    expect(screen.getByTestId('chart-empty')).toHaveTextContent(
      'No manipulability data available',
    )
  })

  it('derives the metrics placeholder from ChartModel.empty when metrics is empty (P4)', async () => {
    render(
      <PlanCharts
        report={baseReport({
          metrics: {},
          manipulability_series: [{ waypoint: 0, yoshikawa: 0.1 }],
        })}
      />,
    )
    const charts = await screen.findAllByTestId('chart', {}, { timeout: 5000 })
    expect(charts).toHaveLength(2)
    expect(screen.getByTestId('chart-empty')).toHaveTextContent('Metrics not available')
  })

  it('renders a placeholder for a null report and no charts at all', async () => {
    render(<PlanCharts report={null} />)
    expect(screen.getByText('No chart data available')).toBeInTheDocument()
    expect(screen.queryAllByTestId('chart')).toHaveLength(0)
    expect(screen.queryAllByTestId('chart-empty')).toHaveLength(0)
  })

  it('delegates ALL domain mapping to the builders and renders their models verbatim (P2 purity)', async () => {
    const report = baseReport()
    render(<PlanCharts report={report} />)
    const els = await screen.findAllByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()

    // The component passes the canonical report UNCHANGED to each builder —
    // no derived object, no local transformation (reference equality).
    expect(manipBuilderMock).toHaveBeenCalledExactlyOnceWith(report)
    expect(scoreBuilderMock).toHaveBeenCalledExactlyOnceWith(report)
    expect(metricsBuilderMock).toHaveBeenCalledExactlyOnceWith(report)

    // What renders equals what the PURE builders produce for the same report:
    // if PlanCharts mapped data itself, rendered values would diverge.
    const expected = [
      realManipBuilder(report),
      realScoreBuilder(report),
      realMetricsBuilder(report),
    ]
    expected.forEach((model, index) => {
      const yValues = model.series[0].data.map((point) =>
        Array.isArray(point) ? point[1] : point,
      )
      expect(valuesOf(optionOf(els[index]))).toEqual(yValues)
    })
  })
})
