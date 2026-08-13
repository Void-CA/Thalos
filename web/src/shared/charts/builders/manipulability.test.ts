import { describe, it, expect } from 'vitest'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import { T_LOW, T_HIGH } from '@/shared/contracts/manipulability-normalization'
import {
  manipulabilityBuilder,
  formatManipulabilityTooltip,
  hasBackendNormalization,
} from './manipulability'

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

type Point = {
  waypoint: number
  yoshikawa: number
  timestamp?: number
  normalized_yoshikawa?: number
  manipulability_grade?: 'low' | 'medium' | 'high'
}

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

const normalizedSeries: Point[] = [
  { waypoint: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.2, manipulability_grade: 'medium' },
  { waypoint: 1, yoshikawa: 0.1, normalized_yoshikawa: 0.05, manipulability_grade: 'low' },
  { waypoint: 2, yoshikawa: 0.9, normalized_yoshikawa: 0.6, manipulability_grade: 'high' },
  { waypoint: 3, yoshikawa: 0.2, normalized_yoshikawa: 0.1, manipulability_grade: 'medium' },
  { waypoint: 4, yoshikawa: 0.5, normalized_yoshikawa: 0.3, manipulability_grade: 'high' },
]

function expectCloseTo(expected: number[], actual: number[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10))
}

/** Y values of a series whose data may be plain numbers or [x, y] tuples. */
function yValuesOf(data: Array<number | [number, number]>): number[] {
  return data.map((point) => (Array.isArray(point) ? point[1] : point))
}

describe('manipulabilityBuilder — normalized primary series (task 5.1, spec manipulability-chart)', () => {
  it('renders the normalized_yoshikawa series as the primary line', () => {
    const model = manipulabilityBuilder(reportWith(normalizedSeries, []))

    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('line')
    expect(model.series[0].name).toBe('Normalized manipulability')
    expectCloseTo(
      normalizedSeries.map((p) => p.normalized_yoshikawa!),
      yValuesOf(model.series[0].data),
    )
    // The raw values are NOT the primary line anymore.
    expect(yValuesOf(model.series[0].data)).not.toEqual(
      normalizedSeries.map((p) => p.yoshikawa),
    )
    expect(model.title).toBe('Manipulability')
  })

  it('marks T_LOW and T_HIGH as reference lines and never an absolute 0.3', () => {
    const model = manipulabilityBuilder(reportWith(normalizedSeries, []))

    expect(model.markLine).toHaveLength(2)
    expect(model.markLine?.[0].yAxis).toBe(T_LOW)
    expect(model.markLine?.[1].yAxis).toBe(T_HIGH)
    expect(model.markLine?.map((l) => l.label)).toEqual(['Low 0.0926', 'High 0.15433'])
    for (const line of model.markLine ?? []) {
      expect(line.yAxis).not.toBe(0.3)
    }
  })

  it('computes the fallback normalized from raw + L_ref for legacy payloads', () => {
    // Legacy payload: no normalized_yoshikawa / manipulability_grade. The
    // builder must derive the series from raw / L_ref³ (local L_ref).
    const legacy = [
      { waypoint: 0, yoshikawa: 0.4 },
      { waypoint: 1, yoshikawa: 0.1 },
    ]
    const lRef = 2.0
    const model = manipulabilityBuilder(reportWith(legacy, []), lRef)

    expectCloseTo(
      [0.4 / 2 ** 3, 0.1 / 2 ** 3],
      yValuesOf(model.series[0].data),
    )
  })

  it('renders legacy payloads without an L_ref by degrading to raw (no-op fallback)', () => {
    const legacy = [
      { waypoint: 0, yoshikawa: 0.4 },
      { waypoint: 1, yoshikawa: 0.1 },
    ]
    const model = manipulabilityBuilder(reportWith(legacy, []))

    expectCloseTo([0.4, 0.1], yValuesOf(model.series[0].data))
  })

  it('ignores a wire normalized_yoshikawa when the grade is absent (flat-zero fix)', () => {
    // Review blocker: `/plan/analyze` is still raw (S1) — the DTO now omits
    // `normalized_yoshikawa`, but a payload carrying `normalized_yoshikawa: 0.0`
    // WITHOUT a grade (legacy/raw path) must NOT be treated as normalized: the
    // fallback runs instead of plotting a fabricated flat-zero line.
    const flatZero = [
      { waypoint: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.0 },
      { waypoint: 1, yoshikawa: 0.1, normalized_yoshikawa: 0.0 },
    ]
    const lRef = 2.0
    const model = manipulabilityBuilder(reportWith(flatZero, []), lRef)

    expectCloseTo([0.4 / 2 ** 3, 0.1 / 2 ** 3], yValuesOf(model.series[0].data))
    expect(yValuesOf(model.series[0].data)).not.toEqual([0.0, 0.0])
  })

  it('uses manipulability_grade as the presence signal, never normalized_yoshikawa', () => {
    // A `normalized_yoshikawa` alone is NOT the signal: 0.0 is a valid measure
    // (singularity) and a raw path could carry it — only the grade marks a
    // normalized payload.
    expect(
      hasBackendNormalization([{ waypoint: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.2 }]),
    ).toBe(false)
    expect(
      hasBackendNormalization([{ waypoint: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.0 }]),
    ).toBe(false)
    expect(
      hasBackendNormalization([{ waypoint: 0, yoshikawa: 0.4, manipulability_grade: 'medium' }]),
    ).toBe(true)
    expect(
      hasBackendNormalization([
        { waypoint: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.0, manipulability_grade: 'low' },
      ]),
    ).toBe(true)
  })

  it('keeps per-point colors from observation severity (unchanged presentation)', () => {
    const model = manipulabilityBuilder(
      reportWith(normalizedSeries, [
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

  it('plots points against their timestamp when present (Time (s) axis)', () => {
    const timed: Point[] = [
      { waypoint: 0, timestamp: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.2, manipulability_grade: 'medium' },
      { waypoint: 1, timestamp: 2, yoshikawa: 0.1, normalized_yoshikawa: 0.05, manipulability_grade: 'low' },
    ]
    const model = manipulabilityBuilder(reportWith(timed, []))

    expect(model.xAxis[0]).toEqual({
      type: 'value',
      name: 'Time (s)',
      min: 0,
      max: 2,
      minInterval: 0.5,
    })
    expect(model.series[0].data).toEqual([
      [0, 0.2],
      [2, 0.05],
    ])
  })

  it('returns an explicit empty state for an absent/empty series', () => {
    const model = manipulabilityBuilder(reportWith([], []))

    expect(model.series).toEqual([])
    expect(model.xAxis).toEqual([])
    expect(model.empty?.message).toBeTruthy()
  })

  it('uses a dimensionless y axis for the normalized measure', () => {
    const model = manipulabilityBuilder(reportWith(normalizedSeries, []))
    expect(model.yAxis?.[0]).toEqual({ type: 'value', name: 'Normalized', scale: true })
  })
})

describe('formatManipulabilityTooltip (task 5.1, spec "Tooltip on Hover")', () => {
  it('renders waypoint index, normalized, grade and raw for a hovered point', () => {
    const html = formatManipulabilityTooltip(
      2, // axis value (waypoint index here)
      normalizedSeries,
    )

    expect(html).toContain('Waypoint 2')
    expect(html).toContain('0.6') // normalized
    expect(html).toContain('high') // grade
    expect(html).toContain('0.9') // raw yoshikawa
  })

  it('falls back to the local classification grade for legacy payloads', () => {
    const legacy: Point[] = [
      { waypoint: 0, yoshikawa: 0.4 },
      { waypoint: 1, yoshikawa: 0.1 },
    ]
    const html = formatManipulabilityTooltip(0, legacy)

    expect(html).toContain('Waypoint 0')
    expect(html).toContain('0.4') // fallback normalized (lRef degraded to raw)
    expect(html).toContain('high') // classifyGrade(0.4, T_LOW, T_HIGH) = high
    expect(html).toContain('0.4') // raw
  })

  it('runs the fallback in the tooltip when the grade is absent even with a wire 0.0', () => {
    // Review blocker (flat-zero): a raw path payload carrying
    // `normalized_yoshikawa: 0.0` without a grade must show the fallback
    // value in the tooltip, never a fabricated 0.0.
    const flatZero: Point[] = [{ waypoint: 0, yoshikawa: 0.4, normalized_yoshikawa: 0.0 }]
    const html = formatManipulabilityTooltip(0, flatZero, 2)

    expect(html).toContain('0.0500') // fallback 0.4/2³
    expect(html).not.toContain('Normalized: 0.0000')
  })

  it('returns a graceful message for an unknown waypoint', () => {
    const html = formatManipulabilityTooltip(99, normalizedSeries)
    expect(html.length).toBeGreaterThan(0)
  })
})
