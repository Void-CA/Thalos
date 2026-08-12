// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { RegionInspector, manipulabilityStatsInRange } from './region-inspector'
import { useAnalysisStore } from '../store'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

// A region whose explanation carries recommended strategies — under PR6 6.5
// the inspector must NOT render per-strategy buttons (zero dispatch by
// strings; the generic RecommendationRow is the only projection of
// recommendations). The panel stays a read-only region detail view.
const report: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: { waypoint_count: 30, has_collisions: 0 },
  summary: {
    quality_index: 0.5,
    score: 50,
    grade: 'Fair',
    observation_count: 0,
    severity_distribution: {},
  },
  problem_regions: [
    {
      id: 7,
      kind: 'singularity',
      severity: 'critical',
      waypoint_start: 10,
      waypoint_end: 12,
      waypoint_count: 3,
      metrics: {
        waypoint_count: 3,
        average_value: 0.42,
        min_value: 0.3,
        max_value: 0.55,
        error_count: 1,
        warning_count: 0,
      },
      explanation: {
        cause: 'Singularity near waypoint 10',
        consequence: 'Tool flips near the goal',
        recommended_strategies: ['Joint centering', 'Lift TCP'],
        confidence: 0.9,
      },
    },
  ],
  // In-range points 10/11/12 → avg 0.2, min 0.1; out-of-range 30 → excluded.
  manipulability_series: [
    { waypoint: 10, yoshikawa: 0.1, det_jtj: 0.01, timestamp: 5 },
    { waypoint: 11, yoshikawa: 0.2, det_jtj: 0.04, timestamp: 6 },
    { waypoint: 12, yoshikawa: 0.3, det_jtj: 0.09, timestamp: 7 },
    { waypoint: 30, yoshikawa: 0.9, timestamp: 20 },
  ],
}

function seedSelectedRegion() {
  useAnalysisStore.setState({ report, selectedRegionId: 7 })
}

function renderInspector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RegionInspector />
    </QueryClientProvider>,
  )
}

describe('RegionInspector (PR6 6.5 — zero per-strategy buttons)', () => {
  afterEach(cleanup)

  it('renders the region details WITHOUT any strategy buttons', () => {
    seedSelectedRegion()
    renderInspector()

    expect(screen.getByRole('heading', { name: 'Region Details' })).toBeInTheDocument()
    // Zero per-strategy buttons: no "Strategies" section, no button named
    // after a recommended strategy (match_strategy UI removed).
    expect(screen.queryByText('Strategies')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Joint centering/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lift TCP/i })).not.toBeInTheDocument()
  })

  it('keeps rendering cause, impact and location for the selected region', () => {
    seedSelectedRegion()
    renderInspector()

    expect(screen.getByText('Singularity near waypoint 10')).toBeInTheDocument()
    expect(screen.getByText('Tool flips near the goal')).toBeInTheDocument()
    expect(screen.getByText('wp10–wp12')).toBeInTheDocument()
  })

  it('enriches the region detail with manipulability (Jacobian) stats from the series', () => {
    seedSelectedRegion()
    renderInspector()

    // Yoshikawa index IS a jacobian property (det(J·Jᵀ)) — the enriched panel
    // must surface it per region, not just the singular-value avg/min/max.
    expect(
      screen.getByRole('heading', { name: 'Manipulability (Jacobian)' }),
    ).toBeInTheDocument()
    expect(screen.getByText('0.2000')).toBeInTheDocument() // average of in-range points
    expect(screen.getByText('0.1000')).toBeInTheDocument() // min of in-range points
    expect(screen.getByText('3 of 3 analyzed')).toBeInTheDocument() // coverage of the span
    // Out-of-range waypoint 30 must NOT leak into the region stats.
    expect(screen.queryByText('0.9000')).not.toBeInTheDocument()
  })

  it('still shows the singular-value metrics with context labels', () => {
    seedSelectedRegion()
    renderInspector()
    expect(screen.getByText('0.4200')).toBeInTheDocument()
    expect(screen.getByText('0.3000')).toBeInTheDocument()
    expect(screen.getByText('0.5500')).toBeInTheDocument()
  })

  it('keeps the region drill-down free of recommended strategies (user does not use them)', () => {
    seedSelectedRegion()
    renderInspector()
    // The user asked to drop recommended strategies from the evaluation view —
    // the block is gone even though the payload still carries them.
    expect(screen.queryByText('Recommended strategies')).not.toBeInTheDocument()
    expect(screen.queryByText('Joint centering')).not.toBeInTheDocument()
    expect(screen.queryByText('Lift TCP')).not.toBeInTheDocument()
    expect(screen.getByText('90% confidence')).toBeInTheDocument()
  })

  it('surfaces the Jacobian determinant (det_jtj) for the region when available', () => {
    seedSelectedRegion()
    renderInspector()

    // det_jtj = yoshikawa² over the in-range span 10/11/12: 0.01, 0.04, 0.09.
    expect(screen.getByText('0.0467')).toBeInTheDocument() // average
    expect(screen.getByText('0.0100')).toBeInTheDocument() // min
    expect(screen.queryByText('0.8100')).not.toBeInTheDocument() // wp30 out of range
  })

  it('handles a region without manipulability coverage gracefully', () => {
    useAnalysisStore.setState({
      report: { ...report, manipulability_series: [] },
      selectedRegionId: 7,
    })
    renderInspector()
    expect(screen.getByText(/no manipulability data/i)).toBeInTheDocument()
  })

  it('shows the region share of the plan with its span duration (R5)', () => {
    seedSelectedRegion()
    renderInspector()

    // 3 of 30 waypoints → 10.0%; series timestamps 5→7 → 2.0s.
    expect(screen.getByText('10.0% of the plan · 2.0s')).toBeInTheDocument()
  })

  it('hides the share when the plan metrics carry no waypoint_count (R5 fallback)', () => {
    useAnalysisStore.setState({
      report: { ...report, metrics: {} },
      selectedRegionId: 7,
    })
    renderInspector()
    expect(screen.queryByText(/of the plan/)).not.toBeInTheDocument()
  })
})

describe('manipulabilityStatsInRange — pure aggregation', () => {
  it('aggregates only the waypoints inside the region span', () => {
    const series = [
      { waypoint: 10, yoshikawa: 0.1 },
      { waypoint: 11, yoshikawa: 0.2 },
      { waypoint: 12, yoshikawa: 0.3 },
      { waypoint: 30, yoshikawa: 0.9 },
    ]
    const stats = manipulabilityStatsInRange(series, 10, 12)
    expect(stats?.count).toBe(3)
    expect(stats?.average).toBeCloseTo(0.2)
    expect(stats?.min).toBeCloseTo(0.1)
  })

  it('returns null when the span has no covered waypoints', () => {
    expect(manipulabilityStatsInRange([{ waypoint: 0, yoshikawa: 1 }], 5, 10)).toBeNull()
  })
})
