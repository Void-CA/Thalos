/**
 * ECharts GL adapter — the ONLY module that imports echarts-gl (O3).
 *
 * Deliberate exception to the chart system contract (P7/P1): ChartModel is a
 * FROZEN 2D contract (`'line' | 'bar' | 'scatter'`), so the 3D trajectory can
 * never flow through the normal builder → adapter pipeline. This module is the
 * isolated GL frontier: it owns the `echarts-gl` import, the line3D/grid3D
 * component registration and the 3D option mapping. The trajectory data model
 * itself is pure and lives in `trajectory3d.ts` (unit-testable without a DOM).
 *
 * Import strategy (tree-shaking): `echarts/core` + explicit `use([...])` with
 * the Line3DChart and Grid3DComponent installers exported by echarts-gl.
 * echarts-gl declares its chart/component modules as side-effectful, so the
 * bundle keeps only what the trajectory needs.
 */

import * as echarts from 'echarts/core'
import { Line3DChart, Scatter3DChart } from 'echarts-gl/charts'
import { Grid3DComponent } from 'echarts-gl/components'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'
import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'
import {
  buildTrajectoryRuns,
  grid3DFrame,
  regionAtWaypoint,
  severityLabel,
  TRAJECTORY_COLOR_END,
  TRAJECTORY_COLOR_MARKER,
  TRAJECTORY_COLOR_START,
  type Vec3,
} from './trajectory3d'
import { resolveChartColor, withAlpha } from './theme'

echarts.use([Line3DChart, Scatter3DChart, Grid3DComponent, TooltipComponent, CanvasRenderer])

const MUTED = resolveChartColor('severity.nodata')
const GRID_SPLIT = withAlpha(resolveChartColor('severity.nodata'), 0.25)
const SELECTED = '#ffffff'

type TooltipParams = {
  seriesIndex: number
  dataIndex: number
  data: number[]
  seriesName?: string
}

/**
 * ChartModel-equivalent for the 3D frontier: maps (waypoints, regions,
 * selection) → ECharts GL option. Pure — safe to unit test without mounting.
 */
export function buildTrajectoryOption(
  waypoints: Vec3[],
  regions: ProblemRegionWire[],
  selectedRegionId: number | null,
  minClearanceWaypoint?: number | null,
): EChartsOption {
  const runs = buildTrajectoryRuns(waypoints, regions)
  const frame = grid3DFrame(waypoints)

  const markerInRange =
    minClearanceWaypoint != null &&
    minClearanceWaypoint >= 0 &&
    minClearanceWaypoint < waypoints.length
  const markerPoint = markerInRange ? waypoints[minClearanceWaypoint as number] : null

  const axis3D = (name: string, min: number, max: number) => ({
    type: 'value',
    name,
    min,
    max,
    axisLabel: { color: MUTED, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: GRID_SPLIT } },
    // axisLine MUST stay visible: echarts-gl only populates `axisLineCoords`
    // (Grid3DAxis.update) when axisLine.show is true, and `_updateAxisLabelAlign`
    // dereferences it on every camera change — hiding it crashes with
    // "can't access property 0 of null". Visible axis lines are also the
    // MATLAB-style reference frame we want for the 3D plot.
    axisLine: { show: true, lineStyle: { color: MUTED } },
    axisTick: { show: false },
  })

  const option = {
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (params: TooltipParams): string => {
        const run = runs[params.seriesIndex]
        if (run === undefined) {
          const [x, y, z] = params.data
          switch (params.seriesName) {
            case 'Start':
              return `Start (waypoint 0)<br/>X ${x.toFixed(3)} · Y ${y.toFixed(3)} · Z ${z.toFixed(3)}`
            case 'End':
              return `Goal (waypoint ${waypoints.length - 1})<br/>X ${x.toFixed(3)} · Y ${y.toFixed(3)} · Z ${z.toFixed(3)}`
            default:
              return markerInRange
                ? `Minimum clearance waypoint ${minClearanceWaypoint}`
                : ''
          }
        }
        const [x, y, z] = params.data
        const globalIndex = run.waypointStart + params.dataIndex
        const region = regionAtWaypoint(regions, globalIndex)
        return [
          `Waypoint ${globalIndex}`,
          `X ${x.toFixed(3)} · Y ${y.toFixed(3)} · Z ${z.toFixed(3)}`,
          region === null ? 'No region' : `Region ${region.id} (${region.severity})`,
        ].join('<br/>')
      },
    },
    grid3D: {
      boxWidth: frame.box.width,
      boxHeight: frame.box.height,
      boxDepth: frame.box.depth,
      viewControl: { autoRotate: false },
      axisPointer: { show: false },
    },
    xAxis3D: axis3D('X', frame.min.x, frame.max.x),
    yAxis3D: axis3D('Y', frame.min.y, frame.max.y),
    zAxis3D: axis3D('Z', frame.min.z, frame.max.z),
    series: runs.map((run) => {
      const selected = run.regionId !== null && run.regionId === selectedRegionId
      return {
        type: 'line3D',
        name: severityLabel(run.severity),
        data: run.points.map((point) => [point.x, point.y, point.z]),
        lineStyle: {
          color: selected ? SELECTED : run.color,
          width: selected ? 5 : run.severity === 'clean' ? 2 : 3.5,
        },
      }
    }),
  }

  if (waypoints.length >= 2) {
    const start = waypoints[0]
    const end = waypoints[waypoints.length - 1]
    const endpointSeries = option.series as unknown[]
    endpointSeries.push(
      {
        type: 'scatter3D',
        name: 'Start',
        data: [[start.x, start.y, start.z]],
        symbol: 'circle',
        symbolSize: 9,
        itemStyle: { color: TRAJECTORY_COLOR_START },
      },
      {
        type: 'scatter3D',
        name: 'End',
        data: [[end.x, end.y, end.z]],
        symbol: 'circle',
        symbolSize: 9,
        itemStyle: { color: TRAJECTORY_COLOR_END },
      },
    )
  }
  if (markerPoint !== null) {
    const markerSeries = option.series as unknown[]
    markerSeries.push({
      type: 'scatter3D',
      name: 'Minimum clearance',
      data: [[markerPoint.x, markerPoint.y, markerPoint.z]],
      symbol: 'diamond',
      symbolSize: 9,
      itemStyle: { color: TRAJECTORY_COLOR_MARKER },
    })
  }
  return option as unknown as EChartsOption
}

/** Initializes (or reuses) the instance on `el` and applies the GL option. */
export function mountGLChart(el: HTMLElement, option: EChartsOption): EChartsType {
  let chart = echarts.getInstanceByDom(el)
  if (chart === undefined) chart = echarts.init(el)
  chart.setOption(option, { notMerge: true })
  return chart
}

/** Resizes the chart on `el` when its container changes size. */
export function resizeGLChart(el: HTMLElement): void {
  echarts.getInstanceByDom(el)?.resize()
}

/** Disposes the instance on `el`. Returns whether one existed. */
export function disposeGLChart(el: HTMLElement): boolean {
  const chart = echarts.getInstanceByDom(el)
  if (chart === undefined) return false
  echarts.dispose(el)
  return true
}
