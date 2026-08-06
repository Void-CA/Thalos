// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanningWorkspace } from './workspace'
import { useAnalysisStore } from '@/features/analysis/store'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * PR2 (workspace-analysis spec "Planning Workspace Tabs Layout"): the Planning
 * workspace organizes its sections into two tabs — "Motion Program"
 * (PlanningPanel + TrajectoryColorPicker) and "Analysis" (AdvisorSection +
 * PlanCharts + AlternativesPanel + AnalysisSection). The Analysis tab shows a
 * badge when `report !== null`, and PlanCharts/AlternativesPanel are
 * data-gated: they SHALL NOT render when `report === null`.
 *
 * PlanCharts/AlternativesPanel are mocked with stubs: this suite verifies the
 * LAYOUT contract (presence/absence by report), not their internals (covered
 * by plan-charts.test.tsx / alternatives-panel tests).
 */

vi.mock('./components/PlanCharts', () => ({
  PlanCharts: () => <div data-testid="plan-charts-stub">PlanCharts</div>,
}))

vi.mock('@/features/analysis/components/alternatives-panel', () => ({
  AlternativesPanel: () => <div data-testid="alternatives-panel-stub">AlternativesPanel</div>,
}))

const report: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.9,
    score: 90,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
}

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanningWorkspace />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
  })
})
afterEach(() => cleanup())

describe('PlanningWorkspace — tabs layout (workspace-analysis spec)', () => {
  it('renders both tabs: Motion Program and Analysis', () => {
    renderWorkspace()
    expect(screen.getByRole('tab', { name: 'Motion Program' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Analysis' })).toBeInTheDocument()
  })

  it('shows no Analysis badge when report === null', () => {
    renderWorkspace()
    expect(screen.queryByTestId('analysis-tab-badge')).not.toBeInTheDocument()
  })

  it('shows the Analysis badge when report !== null', () => {
    act(() => {
      useAnalysisStore.setState({ report })
    })
    renderWorkspace()
    expect(screen.getByTestId('analysis-tab-badge')).toBeInTheDocument()
  })

  it('data-gates PlanCharts and AlternativesPanel: hidden when report === null', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis' }))
    // AdvisorSection + AnalysisSection keep their null-state behavior…
    expect(screen.getByText('No analysis available')).toBeInTheDocument()
    expect(screen.getByText(/Compile and preview a motion program to see analysis/)).toBeInTheDocument()
    // …but the data-gated components SHALL NOT render.
    expect(screen.queryByTestId('plan-charts-stub')).not.toBeInTheDocument()
    expect(screen.queryByTestId('alternatives-panel-stub')).not.toBeInTheDocument()
  })

  it('renders PlanCharts, AlternativesPanel, AdvisorSection and AnalysisSection with a report', () => {
    act(() => {
      useAnalysisStore.setState({ report })
    })
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis' }))
    expect(screen.getByTestId('plan-charts-stub')).toBeInTheDocument()
    expect(screen.getByTestId('alternatives-panel-stub')).toBeInTheDocument()
    // AdvisorSection projects the report (score)…
    expect(screen.getByText(/Score: 90/)).toBeInTheDocument()
    // …and AnalysisSection renders its analysis UI (StatusBanner score).
    expect(screen.getByText(/90 \/ 100/)).toBeInTheDocument()
  })
})
