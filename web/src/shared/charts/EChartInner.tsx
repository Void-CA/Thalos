/**
 * EChartInner — the concrete chart component behind the lazy `EChart` facade
 * (design P6). Renders a ChartModel declaratively with Recharts.
 *
 * The Adapter (`adapter.ts`) is the ONLY module that bridges ChartModel to a
 * chart library (O3). It is now a pure data-shaping layer (`prepareChart` →
 * dataset rows + prepared series + axis/legend/tooltip config), and this
 * component composes the Recharts primitives (ComposedChart / XAxis / YAxis /
 * Line / Area / Bar / Scatter / Tooltip / Legend / Brush / ReferenceLine)
 * from that prepared view. It has no domain knowledge and never imports a
 * chart library directly.
 *
 * Colors ARE always theme-token references resolved by the theme module
 * (`resolveChartColor`); no raw hex is ever emitted here.
 */

import { useMemo } from 'react'
import {
  Area,
  Bar,
  Brush,
  Cell,
  ComposedChart,
  Label,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { prepareChart, TOOLTIP_PANEL } from './adapter'
import type { PreparedSeries } from './adapter'
import { resolveChartColor } from './theme'
import type { ChartModel, ChartSeries, TooltipConfig } from './types'

export interface EChartInnerProps {
  model: ChartModel
  className?: string
}

/**
 * Structural deep equality for ChartModel content (spec "Chart Content
 * Equality Guard"). Function references (tooltip.formatter) compare by
 * identity — two different closures may behave identically but cannot be
 * proven equal. Array order matters (positional data). Missing keys and
 * explicit `undefined` values are equivalent.
 */
export function modelsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'function' || typeof b === 'function') return false
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((value, index) => modelsEqual(value, b[index]))
  }
  const aKeys = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined)
  const bKeys = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) =>
    modelsEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

/** Shape shared by Recharts' dot/activeDot renderer props (index + position). */
type DotShape = {
  index?: number
  cx?: number
  cy?: number
  r?: number | string
}

/**
 * Per-point dot renderer for line/area series with `dataColors` (dense
 * severity-colored segments). Recharts cannot color a line/area STROKE
 * per-point, so the severity colors are carried on the dots' fill — hover
 * and the dot trail expose the per-waypoint severity. The line stroke stays
 * the series color. See the final migration report for the limitation.
 */
function perPointDot(dataColors: string[] | undefined, fallback: string): (props: DotShape) => React.ReactNode {
  return (props) => {
    const ref = props.index !== undefined ? dataColors?.[props.index] : undefined
    const fill = ref ? resolveChartColor(ref) : fallback
    return <circle key={props.index} cx={props.cx} cy={props.cy} r={props.r ?? 3} fill={fill} stroke="none" />
  }
}

type DotRenderer = boolean | ((props: DotShape) => React.ReactNode)

/** Render the series-specific dots/activeDots honouring hideSymbol/dataColors. */
function dotRenderer(
  dataColors: string[] | undefined,
  hideSymbol: boolean,
  color: string,
): { dot: DotRenderer; activeDot: DotRenderer } {
  if (dataColors !== undefined) {
    return { dot: perPointDot(dataColors, color), activeDot: perPointDot(dataColors, color) }
  }
  return { dot: hideSymbol ? false : true, activeDot: true }
}

/** Per-point fill for Bar/Scatter via `<Cell>` children (parallel to data). */
function perPointCells(dataColors: string[] | undefined): React.ReactNode {
  if (dataColors === undefined) return null
  return dataColors.map((ref, i) => <Cell key={i} fill={resolveChartColor(ref)} />)
}

function renderSeries(prepared: PreparedSeries, series: ChartSeries, index: number): React.ReactNode {
  const yAxisId = 'y-0'
  const stackId = series.stack
  const { dot, activeDot } = dotRenderer(series.dataColors, prepared.hideSymbol, prepared.color)
  const key = `series-${index}`

  switch (prepared.type) {
    case 'line': {
      if (prepared.areaStyle) {
        return (
          <Area
            key={key}
            yAxisId={yAxisId}
            name={prepared.name}
            dataKey={prepared.dataKey}
            type={series.smooth ? 'monotone' : 'linear'}
            stroke={prepared.color}
            fill={prepared.color}
            fillOpacity={0.12}
            strokeWidth={2}
            dot={dot}
            activeDot={activeDot}
            isAnimationActive={false}
          />
        )
      }
      return (
        <Line
          key={key}
          yAxisId={yAxisId}
          name={prepared.name}
          dataKey={prepared.dataKey}
          type={series.smooth ? 'monotone' : 'linear'}
          stroke={prepared.color}
          strokeWidth={2}
          dot={dot}
          activeDot={activeDot}
          isAnimationActive={false}
        />
      )
    }
    case 'bar':
      return (
        <Bar
          key={key}
          yAxisId={yAxisId}
          name={prepared.name}
          dataKey={prepared.dataKey}
          fill={prepared.color}
          stackId={stackId}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        >
          {perPointCells(series.dataColors)}
        </Bar>
      )
    case 'scatter':
    default:
      return (
        <Scatter
          key={key}
          yAxisId={yAxisId}
          name={prepared.name}
          dataKey={prepared.dataKey}
          fill={prepared.color}
          isAnimationActive={false}
        >
          {perPointCells(series.dataColors)}
        </Scatter>
      )
  }
}

/** A Recharts Tooltip payload item + the injected container props. */
interface RechartsTooltipEntry {
  dataKey?: string
  name?: string
  value?: unknown
  color?: string
  payload?: Record<string, unknown>
}
interface RechartsTooltipProps {
  active?: boolean
  label?: unknown
  payload?: RechartsTooltipEntry[]
}

/**
 * Tooltip content. Recharts clones the element passed to `<Tooltip content>`
 * and injects `active`/`label`/`payload`. It bridges the frozen ChartModel
 * tooltip.formatter (ECharts-shaped params) to the Recharts payload: the
 * builder formatters read `params[0].axisValue` etc., so the payload is
 * projected onto that shape before delegating. Without a formatter we render
 * the series name + value rows styled with TOOLTIP_PANEL.
 */
function TooltipContent({
  tooltip,
  active,
  label,
  payload,
}: {
  tooltip: TooltipConfig | undefined
} & RechartsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  if (tooltip?.formatter) {
    const params = payload.map((entry) => ({
      dataIndex: entry.payload?.__x ?? undefined,
      axisValue: label,
      name: entry.name,
      seriesName: entry.name,
      value: entry.value,
      data: entry.value,
    }))
    const html =
      tooltip.trigger === 'item' && params.length === 1 ? tooltip.formatter(params[0]) : tooltip.formatter(params)
    return (
      <div style={TOOLTIP_PANEL} className="pointer-events-none rounded-md px-2 py-1.5 text-xs text-foreground">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }
  return (
    <div style={TOOLTIP_PANEL} className="pointer-events-none rounded-md px-2 py-1.5 text-xs text-foreground">
      {label !== undefined && label !== '' ? (
        <div className="mb-1 font-medium text-foreground/80">{String(label)}</div>
      ) : null}
      {payload.map((entry) => (
        <div key={entry.dataKey ?? entry.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{entry.name}</span>
          <span className="ml-auto pl-3 font-mono">{String(entry.value ?? '')}</span>
        </div>
      ))}
    </div>
  )
}

export default function EChartInner({ model, className }: EChartInnerProps) {
  const prepared = useMemo(() => prepareChart(model), [model])

  if (model.empty !== undefined) {
    return (
      <div data-testid="chart-empty" className={className}>
        {model.empty.message}
      </div>
    )
  }

  const xAxis = prepared.xAxis
  const isCategory = (xAxis.type ?? 'category') === 'category'
  const hasDataZoom = prepared.dataZoom !== undefined
  const sliderZoom = hasDataZoom ? prepared.dataZoom!.find((dz) => dz.type === 'slider') : undefined
  const rowCount = prepared.rows.length
  const brushStart = sliderZoom !== undefined && rowCount > 0 ? Math.floor((rowCount * (sliderZoom.start ?? 0)) / 100) : 0
  const brushEnd =
    sliderZoom !== undefined && rowCount > 0 ? Math.max(0, Math.ceil((rowCount * (sliderZoom.end ?? 100)) / 100) - 1) : rowCount - 1

  return (
    <div data-testid="chart" className={className} style={{ width: '100%', height: '100%', minHeight: 160 }}>
      {model.title !== undefined ? (
        <h4 className="px-0 pb-1 text-[13px] font-semibold text-foreground">{model.title}</h4>
      ) : null}
      <ResponsiveContainer width="100%" height={model.title !== undefined ? '90%' : '100%'} initialDimension={{ width: 640, height: 280 }}>
        <ComposedChart data={prepared.rows} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
          {isCategory ? (
            <XAxis dataKey="__xLabel" type="category" name={xAxis.name} interval={0} allowDuplicatedCategory={false} />
          ) : (
            <XAxis dataKey="__x" type="number" name={xAxis.name} domain={xAxisMinMax(xAxis)} allowDataOverflow allowDuplicatedCategory={false} />
          )}
          {prepared.yAxis.map((axis, i) => (
            <YAxis
              key={`y-${i}`}
              yAxisId={`y-${i}`}
              type="number"
              name={axis.name}
              orientation={i === 0 ? 'left' : 'right'}
              width={56}
              domain={axisMinMax(axis)}
            />
          ))}
          {prepared.series.map((s, i) => renderSeries(s, model.series[i], i))}
          {model.legend?.show !== false && model.legend !== undefined ? (
            <Legend verticalAlign={legendVertical(model.legend.position)} align={legendAlign(model.legend.position)} />
          ) : null}
          {sliderZoom !== undefined && rowCount > 0 ? (
            <Brush dataKey={prepared.series[0]?.dataKey} startIndex={brushStart} endIndex={brushEnd} height={18} travellerWidth={8} />
          ) : null}
          {prepared.markLine?.map((ml, i) =>
            ml.yAxis === undefined ? null : (
              <ReferenceLine
                key={`markline-${i}`}
                yAxisId="y-0"
                y={ml.yAxis}
                stroke={ml.color ? resolveChartColor(ml.color) : '#888'}
                strokeDasharray="4 4"
              >
                <Label value={ml.label} position="insideTopRight" fill="#888" fontSize={10} />
              </ReferenceLine>
            ),
          )}
          <Tooltip
            content={<TooltipContent tooltip={model.tooltip} />}
            cursor={{ stroke: 'rgba(136, 136, 136, 0.3)', strokeWidth: 1 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

type DomainPair = readonly [number | 'auto', number | 'auto']

function xAxisMinMax(axis: { min?: number; max?: number; scale?: boolean }): DomainPair {
  // Recharts value axes do NOT force the origin by default, so `scale:true`
  // is naturally honoured (the dynamic range starts at the data minimum).
  // Explicit min/max are honoured; otherwise the axis fits the data.
  const min = axis.min ?? 'auto'
  const max = axis.max ?? 'auto'
  return [min, max]
}

function axisMinMax(axis: { min?: number; max?: number }): DomainPair {
  return [axis.min ?? 'auto', axis.max ?? 'auto']
}

function legendVertical(position?: 'top' | 'bottom' | 'left' | 'right'): 'top' | 'bottom' | 'middle' {
  if (position === 'top') return 'top'
  if (position === 'bottom') return 'bottom'
  return 'top'
}

function legendAlign(position?: 'top' | 'bottom' | 'left' | 'right'): 'left' | 'center' | 'right' {
  if (position === 'left') return 'left'
  if (position === 'right') return 'right'
  return 'center'
}