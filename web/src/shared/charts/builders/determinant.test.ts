import { describe, it, expect } from 'vitest'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import { DET_JTJ_THRESHOLD, determinantBuilder } from './determinant'

function observation(
  id: number,
  waypoint: number,
  severity: 'Error' | 'Warning' | 'Info',
): AnalysisReportWire['observations'][number] {
  return {
    id,
    kind: severity === 'Error' ? 'Singularity' : 'NearSingularity',
    severity,
    artifact: { kind: 'Plan', id: 'p1' },
    location: { Waypoint: waypoint },
    attributes: {},
    causes: [],
    related: [],
  }
}

function reportWith(
  series: Array<{ waypoint: number; yoshikawa: number; det_jtj?: number }>,
  observations: AnalysisReportWire['observations'],
): AnalysisReportWire {
  return {
    artifact: { kind: 'Plan', id: 'p1' },
    observations,
    actions: [],
    metrics: { waypoint_count: series.length },
    summary: {
      quality_index: 0.85,
      score: 85,
      grade: 'B',
      observation_count: observations.length,
      severity_distribution: { Error: 1, Warning: 1, Info: 1 },
    },
    manipulability_series: series,
  }
}

const full = [
  { waypoint: 0, yoshikawa: 0.5, det_jtj: 0.25 },
  { waypoint: 1, yoshikawa: 0.2, det_jtj: 0.04 },
  { waypoint: 2, yoshikawa: 0.6, det_jtj: 0.36 },
  { waypoint: 3, yoshikawa: 0.3, det_jtj: 0.09 },
  { waypoint: 4, yoshikawa: 0.5, det_jtj: 0.25 },
]

describe('determinantBuilder', () => {
  it('projects the full det_jtj series onto a line ChartModel with waypoint value axis', () => {
    const model = determinantBuilder(reportWith(full, []))

    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('line')
    expect(model.series[0].data).toEqual([0.25, 0.04, 0.36, 0.09, 0.25])
    expect(model.xAxis[0]).toEqual({ type: 'value', name: 'Waypoint', min: 0, max: 4 })
    expect(model.dataZoom).toEqual([
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ])
    expect(model.tooltip).toEqual({ trigger: 'axis' })
  })

  it('marks the det_jtj warning threshold as a reference line', () => {
    const model = determinantBuilder(reportWith(full, []))

    expect(model.markLine).toHaveLength(1)
    expect(model.markLine?.[0].yAxis).toBeCloseTo(DET_JTJ_THRESHOLD)
    expect(model.markLine?.[0].label).toMatch(/threshold/i)
  })

  it('maps observation severity at each waypoint to MANIP color tokens', () => {
    const model = determinantBuilder(
      reportWith(full, [
        observation(1, 1, 'Error'),
        observation(2, 3, 'Warning'),
        observation(3, 2, 'Info'),
      ]),
    )

    expect(model.series[0].dataColors).toEqual([
      'manip.high',
      'manip.low',
      'manip.high',
      'manip.med',
      'manip.high',
    ])
  })

  it('drops series points without det_jtj (older payloads) instead of crashing', () => {
    const sparse = [
      { waypoint: 0, yoshikawa: 0.5 },
      { waypoint: 1, yoshikawa: 0.2, det_jtj: 0.04 },
      { waypoint: 2, yoshikawa: 0.6 },
    ]
    const model = determinantBuilder(reportWith(sparse, []))

    expect(model.series[0].data).toEqual([0.04])
    expect(model.xAxis[0]).toEqual({ type: 'value', name: 'Waypoint', min: 0, max: 0 })
  })

  it('returns an explicit empty state when no point carries det_jtj', () => {
    const model = determinantBuilder(reportWith(full.map(({ det_jtj: _, ...rest }) => rest), []))

    expect(model.series).toEqual([])
    expect(model.xAxis).toEqual([])
    expect(model.empty?.message).toBeTruthy()
  })
})
