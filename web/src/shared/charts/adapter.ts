/**
 * Chart system adapter — the ONLY module that bridges ChartModel to a chart
 * library (design P1, O3).
 *
 * Everything else (builders, features, stores) speaks exclusively in
 * ChartModel. This module is the single point where the intermediate contract
 * is projected onto a renderer. It is renderer-agnostic in spirit: the React
 * wrapper (`EChartInner.tsx`) composes the Recharts components declaratively,
 * and this adapter supplies the pure data-shaping helpers (dataset rows,
 * series config, axis/legend/tooltip/markLine configuration) that make each
 * ChartModel render correctly.
 *
 * Recharts composes in React (XAxis/Line/Bar/Scatter/Tooltip/ReferenceLine as
 * JSX), so instead of producing a monolithic option object it produces: the
 * per-row dataset, the ordered list of visual series, and the scalar
 * configuration Recharts needs. It never touches the DOM and never renders.
 */

import { paletteColor, resolveChartColor, withAlpha } from './theme'
import type {
  AxisConfig,
  ChartModel,
  ChartSeries,
  DataZoomConfig,
  LegendConfig,
  MarkLineConfig,
  TooltipConfig,
} from './types'

const MUTED = resolveChartColor('severity.nodata')

/** A single Recharts dataset row, keyed per modeled series. */
export type ChartRow = Record<string, number | string | null>

/** A series ready for a Recharts chart: dataKey into the row + presentation. */
export interface PreparedSeries {
  name: string
  type: ChartSeries['type']
  dataKey: string
  color: string
  hideSymbol: boolean
  areaStyle: boolean
}

export interface PreparedChart {
  rows: ChartRow[]
  series: PreparedSeries[]
  xAxis: AxisConfig
  yAxis: AxisConfig[]
  legend?: LegendConfig
  dataZoom?: DataZoomConfig[]
  tooltip?: TooltipConfig
  markLine?: MarkLineConfig[]
}

/**
 * Each series is projected onto its own column so line/bar/scatter series can
 * share one Cartesian grid (Recharts datum per row, one dataKey per series).
 * Category labels land on `__xLabel`; value/time x data land on `__x`.
 */
export function prepareChart(model: ChartModel): PreparedChart {
  const xAxis = model.xAxis[0] ?? { type: 'category' }
  const categories = xAxis.type === 'category' ? xAxis.categories ?? [] : undefined

  const rows: ChartRow[] = []
  const series: PreparedSeries[] = model.series.map((s, index) => {
    const dataKey = `__s${index}`
    const color = s.color === undefined ? undefined : resolveChartColor(s.color)
    // Per-point colors (dataColors) are applied at the cell level below.
    const fallbackColor = color ?? mutedFor(index)
    return {
      name: s.name,
      type: s.type,
      dataKey,
      color: fallbackColor,
      hideSymbol: s.hideSymbol ?? false,
      areaStyle: s.areaStyle ?? false,
    }
  })

  const rowCount = maxDataLength(model.series)
  for (let i = 0; i < rowCount; i++) {
    const row: ChartRow = {}
    if (categories !== undefined) {
      row.__xLabel = categories[i] ?? ''
    } else {
      // Numeric x from the first series that carries [x, y] pairs or numeric
      // index. Prefer explicit x (time series) over array index.
      const xValue = numericXAt(model.series, i)
      row.__x = xValue
    }
    model.series.forEach((s, index) => {
      row[`__s${index}`] = cellValue(s, i)
    })
    rows.push(row)
  }

  const dataZoom = toDataZoomArray(model.dataZoom)

  return {
    rows,
    series,
    xAxis,
    yAxis: model.yAxis ?? [{ type: 'value' }],
    ...(model.legend !== undefined ? { legend: model.legend } : {}),
    ...(dataZoom.length > 0 ? { dataZoom } : {}),
    ...(model.tooltip !== undefined ? { tooltip: model.tooltip } : {}),
    ...(model.markLine !== undefined ? { markLine: model.markLine } : {}),
  }
}

export const TOOLTIP_PANEL = {
  backgroundColor: withAlpha(resolveChartColor('chart-1'), 0.95),
  borderColor: withAlpha(MUTED, 0.9),
} as const

/** Palette token fallback for series without an explicit color token. */
function mutedFor(index: number): string {
  return paletteColor(index)
}

function toDataZoomArray(dataZoom: ChartModel['dataZoom']): DataZoomConfig[] {
  if (dataZoom === undefined) return []
  return Array.isArray(dataZoom) ? dataZoom : [dataZoom]
}

function maxDataLength(series: ChartSeries[]): number {
  return series.reduce((max, s) => Math.max(max, s.data.length), 0)
}

/** Y value (or [x, y] pair) → the numeric cell for a row. */
function cellValue(series: ChartSeries, index: number): number | string | null {
  const point = series.data[index]
  if (point === undefined) return null
  if (typeof point === 'number') return point
  return point[1]
}

/** The numeric x for a row: explicit [x, y] x, else array index of the longest
 *  series (x projects onto the array index per the contract). */
function numericXAt(series: ChartSeries[], index: number): number {
  for (const s of series) {
    const point = s.data[index]
    if (Array.isArray(point)) return point[0]
  }
  return index
}
