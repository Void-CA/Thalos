/**
 * ECharts adapter — the ONLY module that imports ECharts (design P1, O3).
 *
 * Everything else (builders, features, stores) speaks exclusively in
 * ChartModel. Swapping the chart library touches exactly this file. The React
 * wrapper also goes through this module for mount/resize/dispose, so even the
 * wrapper never imports ECharts directly.
 *
 * Import strategy (tree-shaking): `echarts/core` + explicit `use([...])` with
 * only the chart types and components the ChartModel contract can express.
 * This module lands in a lazy-loaded chunk (see EChart.tsx) and is never part
 * of the initial bundle.
 */

import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { paletteColor, resolveChartColor, withAlpha } from './theme'
import type { AxisConfig, ChartModel, DataZoomConfig } from './types'

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  TitleComponent,
  CanvasRenderer,
])

const MUTED = resolveChartColor('severity.nodata')
const GRID_SPLIT = withAlpha(resolveChartColor('severity.nodata'), 0.25)

function toDataZoomArray(dataZoom: ChartModel['dataZoom']): DataZoomConfig[] {
  if (dataZoom === undefined) return []
  return Array.isArray(dataZoom) ? dataZoom : [dataZoom]
}

function mapAxis(axis: AxisConfig, isX: boolean): Record<string, unknown> {
  const type = axis.type ?? 'category'
  const base: Record<string, unknown> = {
    type,
    ...(axis.name !== undefined ? { name: axis.name } : {}),
    ...(axis.min !== undefined ? { min: axis.min } : {}),
    ...(axis.max !== undefined ? { max: axis.max } : {}),
    ...(axis.minInterval !== undefined ? { minInterval: axis.minInterval } : {}),
    ...(axis.scale !== undefined ? { scale: axis.scale } : {}),
    axisLabel: { color: MUTED, fontSize: 11 },
  }
  if (isX) {
    base.axisTick = { show: false }
    base.axisLine = { lineStyle: { color: MUTED } }
    if (type === 'category') base.data = axis.categories ?? []
  } else {
    base.axisTick = { show: false }
    base.axisLine = { show: false }
    base.splitLine = { lineStyle: { color: GRID_SPLIT } }
  }
  return base
}

function mapSeriesData(series: ChartModel['series'][number]): unknown[] {
  if (series.dataColors === undefined) return series.data
  return series.data.map((value, index) => ({
    value,
    itemStyle: { color: resolveChartColor(series.dataColors![index]) },
  }))
}

function mapSeries(series: ChartModel['series'][number], index: number): Record<string, unknown> {
  const color = series.color === undefined ? paletteColor(index) : resolveChartColor(series.color)
  const base: Record<string, unknown> = {
    name: series.name,
    type: series.type,
    data: mapSeriesData(series),
    ...(series.stack !== undefined ? { stack: series.stack } : {}),
  }
  if (series.type === 'line') {
    base.smooth = series.smooth ?? false
    base.symbol = series.hideSymbol ? 'none' : 'circle'
    base.symbolSize = 5
    base.lineStyle = { color, width: 2 }
    base.itemStyle = { color }
    if (series.areaStyle) base.areaStyle = { opacity: 0.12 }
  } else if (series.type === 'bar') {
    base.itemStyle = { color, borderRadius: [2, 2, 0, 0] }
  } else {
    base.symbolSize = 8
    base.itemStyle = { color }
  }
  return base
}

/** Single point of conversion: ChartModel → EChartsOption (design P7/P1). */
export function toEChartsOption(model: ChartModel): EChartsOption {
  const dataZoom = toDataZoomArray(model.dataZoom)
  const hasSlider = dataZoom.some((zoom) => zoom.type === 'slider')

  const option: EChartsOption = {}

  if (model.title !== undefined) {
    option.title = {
      text: model.title,
      left: 0,
      textStyle: { color: MUTED, fontSize: 13, fontWeight: 600 },
    }
  }

  if (model.tooltip !== undefined) {
    option.tooltip = { trigger: model.tooltip.trigger, confine: true }
  }

  if (model.legend !== undefined) {
    const position: Record<string, unknown> =
      model.legend.position === 'top'
        ? { top: 0 }
        : model.legend.position === 'left'
          ? { left: 0 }
          : model.legend.position === 'right'
            ? { right: 0 }
            : { bottom: 0 }
    option.legend = {
      show: model.legend.show,
      ...position,
      textStyle: { color: MUTED, fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    }
  }

  option.grid = {
    top: model.title !== undefined ? 40 : 24,
    right: 16,
    bottom: hasSlider ? 56 : 24,
    left: 16,
    containLabel: true,
  }

  option.xAxis = model.xAxis.map((axis) => mapAxis(axis, true))
  option.yAxis = (model.yAxis ?? [{ type: 'value' }]).map((axis) => mapAxis(axis, false))

  if (dataZoom.length > 0) {
    option.dataZoom = dataZoom.map((zoom) =>
      zoom.type === 'slider'
        ? { type: 'slider', start: zoom.start ?? 0, end: zoom.end ?? 100, bottom: 8, height: 16 }
        : { type: 'inside', start: zoom.start ?? 0, end: zoom.end ?? 100 },
    )
  }

  const series = model.series.map(mapSeries)
  option.series = series as EChartsOption['series']

  if (model.markLine !== undefined && model.markLine.length > 0 && series.length > 0) {
    const color =
      model.markLine[0].color === undefined
        ? resolveChartColor('severity.warning')
        : resolveChartColor(model.markLine[0].color)
    const first = series[0] as unknown as Record<string, unknown>
    if (first !== undefined) {
      first.markLine = {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', color },
        data: model.markLine.map((line) => ({
          yAxis: line.yAxis,
          lineStyle: {
            color: line.color === undefined ? color : resolveChartColor(line.color),
          },
          label: { formatter: line.label, color: MUTED, fontSize: 10 },
        })),
      }
    }
  }

  return option
}

/** Initializes (or reuses) the instance on `el` and applies the model. */
export function mountChart(el: HTMLElement, model: ChartModel): void {
  let chart = echarts.getInstanceByDom(el)
  if (chart === undefined) chart = echarts.init(el)
  chart.setOption(toEChartsOption(model), { notMerge: true })
}

/** Resizes the chart on `el` when its container changes size. */
export function resizeChart(el: HTMLElement): void {
  echarts.getInstanceByDom(el)?.resize()
}

/** Disposes the instance on `el`. Returns whether one existed. */
export function disposeChart(el: HTMLElement): boolean {
  const chart = echarts.getInstanceByDom(el)
  if (chart === undefined) return false
  echarts.dispose(el)
  return true
}
