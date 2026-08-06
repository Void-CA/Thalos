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

type Point = { waypoint: number; yoshikawa: number; det_jtj?: number; timestamp?: number }

function reportWith(
  series: Point[],
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

function expectCloseTo(expected: number[], actual: number[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10))
}

/** Y values of a series whose data may be plain numbers or [x, y] tuples. */
function yValuesOf(data: Array<number | [number, number]>): number[] {
  return data.map((point) => (Array.isArray(point) ? point[1] : point))
}

describe('determinantBuilder', () => {
  it('projects the det_jtj series as -log10 with scale:true yAxis and no smoothing', () => {
    const model = determinantBuilder(reportWith(full, []))

    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('line')
    expectCloseTo(
      full.map((p) => -Math.log10(p.det_jtj!)),
      yValuesOf(model.series[0].data),
    )
    expect(model.series[0].smooth).toBe(false)
    expect(model.yAxis?.[0]).toEqual({
      type: 'value',
      name: '-log10(Det(J·Jᵀ))',
      scale: true,
    })
    expect(model.dataZoom).toEqual([
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ])
    expect(model.tooltip).toEqual({ trigger: 'axis' })
  })

  it('plots points against their timestamp when present (Time (s) axis, [ts, value] pairs)', () => {
    const timed = [
      { waypoint: 0, timestamp: 0, yoshikawa: 0.5, det_jtj: 0.25 },
      { waypoint: 1, timestamp: 0.01, yoshikawa: 0.2, det_jtj: 0.04 },
      { waypoint: 2, timestamp: 2, yoshikawa: 0.6, det_jtj: 0.36 },
    ]
    const model = determinantBuilder(reportWith(timed, []))

    expect(model.xAxis[0]).toEqual({
      type: 'value',
      name: 'Time (s)',
      min: 0,
      max: 2,
      minInterval: 0.5,
    })
    expect(model.series[0].data).toEqual([
      [0, -Math.log10(0.25)],
      [0.01, -Math.log10(0.04)],
      [2, -Math.log10(0.36)],
    ])
  })

  it('falls back to the waypoint index for payloads without timestamps (old backends)', () => {
    const model = determinantBuilder(reportWith(full, []))

    expect(model.xAxis[0]).toEqual({ type: 'value', name: 'Waypoint', min: 0, max: 4 })
    expect(model.series[0].data).toEqual([
      [0, -Math.log10(0.25)],
      [1, -Math.log10(0.04)],
      [2, -Math.log10(0.36)],
      [3, -Math.log10(0.09)],
      [4, -Math.log10(0.25)],
    ])
  })

  it('maps an exactly-zero det_jtj to the log floor (visible singularity spike)', () => {
    const model = determinantBuilder(
      reportWith(
        [
          { waypoint: 0, timestamp: 0, yoshikawa: 0.5, det_jtj: 0.25 },
          { waypoint: 1, timestamp: 0.01, yoshikawa: 0, det_jtj: 0 },
        ],
        [],
      ),
    )

    expect(model.series[0].data).toEqual([
      [0, -Math.log10(0.25)],
      [0.01, 6],
    ])
  })

  it('marks the det_jtj warning threshold converted to the log scale', () => {
    const model = determinantBuilder(reportWith(full, []))

    expect(model.markLine).toHaveLength(1)
    expect(model.markLine?.[0].yAxis).toBeCloseTo(-Math.log10(DET_JTJ_THRESHOLD), 5)
    expect(model.markLine?.[0].label).toMatch(/threshold/i)
  })

  it('maps observation severity at each waypoint to MANIP color tokens, parallel to the data', () => {
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
    expect(model.series[0].dataColors).toHaveLength(model.series[0].data.length)
  })

  it('drops series points without det_jtj (older payloads) instead of crashing', () => {
    const sparse = [
      { waypoint: 0, yoshikawa: 0.5 },
      { waypoint: 1, yoshikawa: 0.2, det_jtj: 0.04 },
      { waypoint: 2, yoshikawa: 0.6 },
    ]
    const model = determinantBuilder(reportWith(sparse, []))

    expectCloseTo([-Math.log10(0.04)], yValuesOf(model.series[0].data))
    expect(model.xAxis[0]).toEqual({ type: 'value', name: 'Waypoint', min: 0, max: 0 })
  })

  it('returns an explicit empty state when no point carries det_jtj', () => {
    const model = determinantBuilder(reportWith(full.map(({ det_jtj: _, ...rest }) => rest), []))

    expect(model.series).toEqual([])
    expect(model.xAxis).toEqual([])
    expect(model.empty?.message).toBeTruthy()
  })
})
