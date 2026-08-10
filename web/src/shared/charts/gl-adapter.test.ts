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
    const lineRuns = series.filter((s) => s.type === 'line3D')
    expect(lineRuns).toHaveLength(3)
    expect(lineRuns.every((s) => s.type === 'line3D')).toBe(true)
    expect(lineRuns[0]).toMatchObject({ name: 'Clean', data: [[0, 0, 0], [1, 0, 0]] })
    expect(lineRuns[1]).toMatchObject({
      name: 'Critical',
      data: [[1, 0, 0], [2, 0, 0]],
      lineStyle: { color: '#ef4444' },
    })
    expect(lineRuns[2]).toMatchObject({ name: 'Clean' })
    // The endpoint Start/End markers ride along as scatter3D series.
    expect(series.some((s) => s.type === 'scatter3D' && s.name === 'Start')).toBe(true)
    expect(series.some((s) => s.type === 'scatter3D' && s.name === 'End')).toBe(true)

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
      series: Array<{ name?: string; type: string; data?: Array<[number, number, number]> }>
    }
    const marker = option.series.find((s) => s.name === 'Minimum clearance')
    expect(marker).toBeTruthy()
    expect(marker?.data).toEqual([[3, 0, 0]])
  })

  it('emits no minimum-clearance scatter3D when the waypoint is absent or out of range (Start/End still emit)', () => {
    const absent = buildTrajectoryOption(waypoints, [criticalRegion], null, null) as {
      series: Array<{ name?: string; type: string }>
    }
    const outOfRange = buildTrajectoryOption(waypoints, [criticalRegion], null, 999) as {
      series: Array<{ name?: string; type: string }>
    }
    expect(absent.series.some((s) => s.name === 'Minimum clearance')).toBe(false)
    expect(outOfRange.series.some((s) => s.name === 'Minimum clearance')).toBe(false)
    // The endpoint markers are independent of the clearance marker.
    expect(absent.series.some((s) => s.name === 'Start')).toBe(true)
    expect(absent.series.some((s) => s.name === 'End')).toBe(true)
  })

  it('marks the trajectory endpoints with Start/End scatter3D series when there are >= 2 waypoints', () => {
    const option = buildTrajectoryOption(waypoints, [], null) as {
      series: Array<{
        type?: string
        name?: string
        data?: Array<[number, number, number]>
        symbol?: string
        symbolSize?: number
        itemStyle?: { color?: string }
      }>
    }
    const start = option.series.find((s) => s.name === 'Start')
    const end = option.series.find((s) => s.name === 'End')
    expect(start).toBeTruthy()
    expect(start?.type).toBe('scatter3D')
    expect(start?.data).toEqual([[0, 0, 0]])
    expect(start?.symbol).toBe('circle')
    expect(start?.symbolSize).toBe(9)
    expect(start?.itemStyle?.color).toBe('#22c55e')
    expect(end).toBeTruthy()
    expect(end?.type).toBe('scatter3D')
    expect(end?.data).toEqual([[5, 0, 0]])
    expect(end?.symbol).toBe('circle')
    expect(end?.itemStyle?.color).toBe('#ef4444')
  })

  it('emits no Start/End series for degenerate trajectories (< 2 waypoints)', () => {
    const single = buildTrajectoryOption([{ x: 0, y: 0, z: 0 }], [], null) as {
      series: Array<{ name?: string }>
    }
    const empty = buildTrajectoryOption([], [], null) as { series: Array<{ name?: string }> }
    expect(single.series.some((s) => s.name === 'Start' || s.name === 'End')).toBe(false)
    expect(empty.series.some((s) => s.name === 'Start' || s.name === 'End')).toBe(false)
  })

  it('keeps Start/End and the minimum-clearance marker together without interference', () => {
    const option = buildTrajectoryOption(waypoints, [criticalRegion], null, 3) as {
      series: Array<{ name?: string; data?: Array<[number, number, number]> }>
    }
    const names = option.series.map((s) => s.name)
    expect(names).toContain('Start')
    expect(names).toContain('End')
    expect(names).toContain('Minimum clearance')
    expect(option.series.find((s) => s.name === 'Minimum clearance')?.data).toEqual([[3, 0, 0]])
    expect(option.series.find((s) => s.name === 'Start')?.data).toEqual([[0, 0, 0]])
    expect(option.series.find((s) => s.name === 'End')?.data).toEqual([[5, 0, 0]])
  })

  it('tooltip formatter labels the Start and End markers with their waypoint indices', () => {
    const option = buildTrajectoryOption(waypoints, [], null) as {
      tooltip: { formatter: (params: { seriesName?: string; data: number[] }) => string }
    }
    const startHtml = option.tooltip.formatter({ seriesName: 'Start', data: [0, 0, 0] })
    expect(startHtml).toContain('Start (waypoint 0)')
    expect(startHtml).toContain('X 0.000')
    const endHtml = option.tooltip.formatter({ seriesName: 'End', data: [5, 0, 0] })
    expect(endHtml).toContain('Goal (waypoint 5)')
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
