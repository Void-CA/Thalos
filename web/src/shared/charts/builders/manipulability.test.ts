import { describe, it, expect } from 'vitest'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import { manipulabilityBuilder } from './manipulability'
import { toLogScale } from './log-scale'

function observation(
  id: number,
  waypoint: number,
  severity: 'Error' | 'Warning' | 'Info',
): AnalysisReportWire['observations'][number] {
  return {
    id,
    kind: severity === 'Error' ? 'LowManipulability' : 'NearSingularity',
    severity,
    artifact: { kind: 'Plan', id: 'p1' },
    location: { Waypoint: waypoint },
    attributes: {},
    causes: [],
    related: [],
  }
}

function reportWith(
  series: Array<{ waypoint: number; yoshikawa: number }>,
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

const series = [
  { waypoint: 0, yoshikawa: 0.2 },
  { waypoint: 1, yoshikawa: 0.05 },
  { waypoint: 2, yoshikawa: 0.3 },
  { waypoint: 3, yoshikawa: 0.12 },
  { waypoint: 4, yoshikawa: 0.25 },
]

function expectCloseTo(expected: number[], actual: number[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10))
}

describe('manipulabilityBuilder', () => {
  it('projects the yoshikawa series as -log10 with scale:true yAxis and no smoothing', () => {
    const model = manipulabilityBuilder(reportWith(series, []))

    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('line')
    expectCloseTo(series.map((p) => -Math.log10(p.yoshikawa)), model.series[0].data)
    expect(model.series[0].smooth).toBe(false)
    expect(model.xAxis[0]).toEqual({ type: 'value', name: 'Waypoint', min: 0, max: 4 })
    expect(model.yAxis?.[0]).toEqual({ type: 'value', name: '-log10(Yoshikawa)', scale: true })
    expect(model.dataZoom).toEqual([
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ])
    expect(model.tooltip).toEqual({ trigger: 'axis' })
  })

  it('maps an exactly-zero yoshikawa to the log floor (visible singularity spike)', () => {
    const model = manipulabilityBuilder(
      reportWith(
        [
          { waypoint: 0, yoshikawa: 0.2 },
          { waypoint: 1, yoshikawa: 0 },
        ],
        [],
      ),
    )

    expect(model.series[0].data).toEqual([toLogScale(0.2), 6])
  })

  it('maps observation severity at each waypoint to MANIP color tokens', () => {
    const model = manipulabilityBuilder(
      reportWith(series, [
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

  it('resolves a waypoint to the worst severity present (Error beats Warning beats Info)', () => {
    const model = manipulabilityBuilder(
      reportWith(
        [
          { waypoint: 0, yoshikawa: 0.2 },
          { waypoint: 1, yoshikawa: 0.05 },
          { waypoint: 2, yoshikawa: 0.3 },
        ],
        [
          observation(1, 1, 'Warning'),
          observation(2, 1, 'Error'),
          observation(3, 2, 'Info'),
        ],
      ),
    )

    expect(model.series[0].dataColors).toEqual(['manip.high', 'manip.low', 'manip.high'])
  })

  it('marks the low-manipulability warning threshold converted to the log scale', () => {
    const model = manipulabilityBuilder(reportWith(series, []))

    expect(model.markLine).toHaveLength(1)
    expect(model.markLine?.[0].yAxis).toBeCloseTo(-Math.log10(0.3), 5)
    expect(model.markLine?.[0].label).toMatch(/threshold/i)
  })

  it('returns an explicit empty state for an absent/empty series instead of a chart', () => {
    const model = manipulabilityBuilder(reportWith([], []))

    expect(model.series).toEqual([])
    expect(model.xAxis).toEqual([])
    expect(model.empty?.message).toBeTruthy()
  })
})
