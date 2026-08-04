import { describe, it, expect } from 'vitest'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import { metricsDashboardBuilder, scoreBreakdownBuilder } from './metrics-dashboard'

function baseReport(overrides: Partial<AnalysisReportWire> = {}): AnalysisReportWire {
  return {
    artifact: { kind: 'Plan', id: 'p1' },
    observations: [],
    actions: [],
    metrics: { waypoint_count: 10 },
    summary: {
      quality_index: 0.85,
      score: 85,
      grade: 'B',
      observation_count: 2,
      severity_distribution: { Error: 3, Warning: 5, Info: 2 },
    },
    ...overrides,
  }
}

describe('scoreBreakdownBuilder', () => {
  it('projects summary.score as a 0-100 readout bar', () => {
    const model = scoreBreakdownBuilder(baseReport())

    expect(model.title).toBe('Score: 85')
    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('bar')
    expect(model.series[0].data).toEqual([85])
    expect(model.xAxis[0]).toEqual({ type: 'category', categories: ['Score'] })
    expect(model.yAxis?.[0]).toEqual({ type: 'value', min: 0, max: 100, name: 'Score' })
  })

  it('keeps fractional scores verbatim (presentation only, no rounding)', () => {
    const model = scoreBreakdownBuilder(baseReport({ summary: { ...baseReport().summary, score: 85.5 } }))

    expect(model.title).toBe('Score: 85.5')
    expect(model.series[0].data).toEqual([85.5])
  })

  it('renders a zero score without treating it as missing data', () => {
    const model = scoreBreakdownBuilder(baseReport({ summary: { ...baseReport().summary, score: 0 } }))

    expect(model.series[0].data).toEqual([0])
    expect(model.empty).toBeUndefined()
  })
})

describe('metricsDashboardBuilder', () => {
  it('projects summary.severity_distribution as a per-severity bar chart', () => {
    const model = metricsDashboardBuilder(baseReport())

    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('bar')
    expect(model.series[0].data).toEqual([3, 5, 2])
    expect(model.xAxis[0]).toEqual({ type: 'category', categories: ['Error', 'Warning', 'Info'] })
    expect(model.series[0].dataColors).toEqual([
      'severity.critical',
      'severity.warning',
      'severity.good',
    ])
  })

  it('uses severity_distribution verbatim and never re-aggregates observations (I2)', () => {
    const report = baseReport({
      summary: { ...baseReport().summary, severity_distribution: { Error: 1 } },
      observations: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        kind: 'CollisionRisk',
        severity: 'Error' as const,
        artifact: { kind: 'Plan', id: 'p1' },
        location: { Waypoint: i },
        attributes: {},
        causes: [],
        related: [],
      })),
    })

    const model = metricsDashboardBuilder(report)

    expect(model.series[0].data).toEqual([1, 0, 0])
  })

  it('fills absent severity levels with zero counts', () => {
    const model = metricsDashboardBuilder(
      baseReport({ summary: { ...baseReport().summary, severity_distribution: { Warning: 2 } } }),
    )

    expect(model.series[0].data).toEqual([0, 2, 0])
  })

  it('returns an explicit placeholder when metrics is empty (spec "Missing metrics")', () => {
    const model = metricsDashboardBuilder(baseReport({ metrics: {} }))

    expect(model.series).toEqual([])
    expect(model.xAxis).toEqual([])
    expect(model.empty?.message).toBeTruthy()
  })
})
