/**
 * ChartModel — the presentation contract of the chart system (design P7).
 *
 * The pipeline is: canonical DTO → pure builder → ChartModel → ECharts adapter
 * → React wrapper. Builders and the rest of the app speak ONLY in ChartModel;
 * ECharts appears in exactly one module (`adapter.ts`).
 *
 * This type is the FROZEN contract of slice S2: no later slice (S3–S6) may add
 * fundamental concepts to it. It covers every consumer: line series
 * (manipulability, trace), bar series (score breakdown, metrics, comparison),
 * scatter/timeline markers, dataZoom, multiple axes and per-point colors.
 *
 * Colors are ALWAYS token references (theme keys such as `'severity.critical'`
 * or `'chart-1'`), never raw hex. The theme layer owns the hex.
 */

export type SeriesType = 'line' | 'bar' | 'scatter'

export type AxisType = 'category' | 'value' | 'time'

/** One chart series. `data` is the Y axis; X is the array index projected
 *  onto the first xAxis (category label, value, or time). */
export interface ChartSeries {
  name: string
  type: SeriesType
  /** Y values. X position is the array index. */
  data: number[]
  /** Series color — theme token reference (e.g. 'chart-1', 'severity.good'). */
  color?: string
  /** Per-point color token references, parallel to `data`. */
  dataColors?: string[]
  /** Stack group id: series sharing it are stacked. */
  stack?: string
  /** Smooth curve for line series. */
  smooth?: boolean
  /** Hide per-point symbols (dense line data). */
  hideSymbol?: boolean
  /** Fill the area under a line series. */
  areaStyle?: boolean
}

/** One chart axis. `type` defaults to 'category'. */
export interface AxisConfig {
  type?: AxisType
  /** Axis title (e.g. 'Waypoint'). */
  name?: string
  /** Category labels — required when `type` is 'category'. */
  categories?: string[]
  min?: number
  max?: number
  /** Do not force the origin into view — ECharts scale. Needed for log-scale
   *  axes where forcing 0 would flatten the data. */
  scale?: boolean
}

/** Horizontal reference line (design markLine, e.g. RMSE on a comparison
 *  chart). Attached by the adapter to the first series. */
export interface MarkLineConfig {
  /** Y value at which to draw the line. */
  yAxis?: number
  label: string
  /** Token reference for the line color. */
  color?: string
}

export interface LegendConfig {
  show: boolean
  position?: 'top' | 'bottom' | 'left' | 'right'
}

export interface TooltipConfig {
  trigger: 'axis' | 'item'
}

export interface DataZoomConfig {
  type: 'slider' | 'inside'
  /** Visible window in percent (0–100). */
  start?: number
  end?: number
}

/** Explicit empty state rendered instead of a chart (spec empty-series and
 *  missing-metrics scenarios). */
export interface ChartEmptyState {
  message: string
}

/** The chart system's intermediate contract (design P7). */
export interface ChartModel {
  title?: string
  series: ChartSeries[]
  xAxis: AxisConfig[]
  /** Optional; defaults to a single `{ type: 'value' }` axis. */
  yAxis?: AxisConfig[]
  legend?: LegendConfig
  dataZoom?: DataZoomConfig | DataZoomConfig[]
  tooltip?: TooltipConfig
  markLine?: MarkLineConfig[]
  empty?: ChartEmptyState
}
