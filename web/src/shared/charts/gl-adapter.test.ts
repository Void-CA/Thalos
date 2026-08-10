// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildTrajectoryOption } from './gl-adapter'
import type { ProblemRegionWire } from '@/shared/contracts/analysis-report'

type Line3DSeries = {
  type: string
  name: string
  data: Array<[number, number, number]>
  lineStyle?: { color?: string; width?: number }
}

const waypoints = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 3, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 5, y: 0, z: 0 },
]

const criticalRegion: ProblemRegionWire = {
  id: 1,
  kind: 'singularity',
  severity: 'critical',
  waypoint_start: 1,
  waypoint_end: 2,
  waypoint_count: 2,
}

describe('buildTrajectoryOption — ECharts GL line3D option', () => {
  it('emits one line3D series per severity run with [x,y,z] data and per-run colors', () => {
    const option = buildTrajectoryOption(waypoints, [criticalRegion], null) as {
      series: Line3DSeries[]
      grid3D: { boxWidth: number; boxHeight: number; boxDepth: number }
      xAxis3D: { type: string; name: string }
      yAxis3D: { type: string; name: string }
      zAxis3D: { type: string; name: string }
    }

    const series = option.series
    expect(series).toHaveLength(3)
    expect(series.every((s) => s.type === 'line3D')).toBe(true)
    expect(series[0]).toMatchObject({ name: 'Clean', data: [[0, 0, 0], [1, 0, 0]] })
    expect(series[1]).toMatchObject({
      name: 'Critical',
      data: [[1, 0, 0], [2, 0, 0]],
      lineStyle: { color: '#ef4444' },
    })
    expect(series[2]).toMatchObject({ name: 'Clean' })

    // 3D axes + auto-fit grid3D box.
    expect(option.xAxis3D).toMatchObject({ type: 'value', name: 'X' })
    expect(option.yAxis3D).toMatchObject({ type: 'value', name: 'Y' })
    expect(option.zAxis3D).toMatchObject({ type: 'value', name: 'Z' })
    expect(option.grid3D.boxWidth).toBeGreaterThan(0)
    expect(option.grid3D.boxHeight).toBeGreaterThan(0)
    expect(option.grid3D.boxDepth).toBeGreaterThan(0)
  })

  it('highlights the selected region run in white and thicker', () => {
    const option = buildTrajectoryOption(waypoints, [criticalRegion], 1) as {
      series: Line3DSeries[]
    }
    const critical = option.series.find((s) => s.name === 'Critical')

    expect(critical?.lineStyle?.color).toBe('#ffffff')
    expect(critical?.lineStyle?.width).toBe(5)
  })

  it('tooltip formatter shows the global waypoint index, position and covering region', () => {
    const option = buildTrajectoryOption(waypoints, [criticalRegion], null) as {
      tooltip: { formatter: (params: { seriesIndex: number; dataIndex: number; data: number[] }) => string }
    }
    const html = option.tooltip.formatter({ seriesIndex: 1, dataIndex: 0, data: [1, 0, 0] })

    expect(html).toContain('Waypoint 1')
    expect(html).toContain('X')
    expect(html).toContain('Region 1')
  })

  it('tooltip formatter reports no region for clean waypoints', () => {
    const option = buildTrajectoryOption(waypoints, [criticalRegion], null) as {
      tooltip: { formatter: (params: { seriesIndex: number; dataIndex: number; data: number[] }) => string }
    }
    const html = option.tooltip.formatter({ seriesIndex: 0, dataIndex: 0, data: [0, 0, 0] })

    expect(html).toContain('No region')
    expect(html).not.toContain('Region 1')
  })

  it('emits no series for a degenerate trajectory (empty option still valid)', () => {
    const option = buildTrajectoryOption([], [], null) as { series: unknown[] }

    expect(option.series).toEqual([])
  })

  it('marks the minimum-clearance waypoint with a scatter3D series when provided', () => {
    const option = buildTrajectoryOption(waypoints, [criticalRegion], null, 3) as {
      series: Array<{ type: string; data?: Array<[number, number, number]> }>
    }
    const marker = option.series.find((s) => s.type === 'scatter3D')
    expect(marker).toBeTruthy()
    expect(marker?.data).toEqual([[3, 0, 0]])
  })

  it('emits no scatter3D marker when the waypoint is absent or out of range', () => {
    const absent = buildTrajectoryOption(waypoints, [criticalRegion], null, null) as {
      series: Array<{ type: string }>
    }
    const outOfRange = buildTrajectoryOption(waypoints, [criticalRegion], null, 999) as {
      series: Array<{ type: string }>
    }
    expect(absent.series.every((s) => s.type === 'line3D')).toBe(true)
    expect(outOfRange.series.every((s) => s.type === 'line3D')).toBe(true)
  })

  it('keeps axisLine visible on every 3D axis (echarts-gl crashes when hidden)', () => {
    // Regression: Grid3DAxis.update only populates `axisLineCoords` when
    // axisLine.show is true, and Grid3DView._updateAxisLabelAlign dereferences
    // it on camera change. Hiding the axis line crashed with
    // "can't access property 0 of null" in the browser.
    const option = buildTrajectoryOption(waypoints, [criticalRegion], null) as {
      xAxis3D: { axisLine?: { show?: boolean } }
      yAxis3D: { axisLine?: { show?: boolean } }
      zAxis3D: { axisLine?: { show?: boolean } }
    }

    expect(option.xAxis3D.axisLine?.show).toBe(true)
    expect(option.yAxis3D.axisLine?.show).toBe(true)
    expect(option.zAxis3D.axisLine?.show).toBe(true)
  })
})
