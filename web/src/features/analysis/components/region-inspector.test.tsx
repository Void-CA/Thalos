// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { RegionInspector } from './region-inspector'
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
  metrics: {},
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
      waypoint_end: 20,
      waypoint_count: 11,
      explanation: {
        cause: 'Singularity near waypoint 10',
        consequence: 'Tool flips near the goal',
        recommended_strategies: ['Joint centering', 'Lift TCP'],
        confidence: 0.9,
      },
    },
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
    expect(screen.getByText('wp10–wp20')).toBeInTheDocument()
  })
})
