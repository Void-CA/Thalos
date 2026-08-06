// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { ProgrammingWorkspace } from './workspace'
import { useAnalysisStore } from '@/features/analysis/store'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * ProgrammingWorkspace — the UNIFIED programming area (hotfix: /task + /planning
 * merged into ONE workspace under /task, stage 3). The three ways to command
 * the robot — semantic editor (Tasks, with internal Visual/Text), motion
 * program by segments (Motion), and the analysis view (Analysis) — are
 * tabs of the same workspace, communicating that they are ONE interaction
 * medium to send orders to the robot.
 *
 * PR2 (workspace-analysis spec "Tabs Layout"): the Analysis tab shows a badge
 * when `report !== null`, and PlanCharts/AlternativesPanel are data-gated:
 * they SHALL NOT render when `report === null`.
 *
 * PlanCharts/AlternativesPanel are mocked with stubs: this suite verifies the
 * LAYOUT contract (presence/absence by report), not their internals (covered
 * by plan-charts.test.tsx / alternatives-panel tests).
 */

vi.mock('../planning/components/PlanCharts', () => ({
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ProgrammingWorkspace />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
  })
})
afterEach(() => cleanup())

describe('ProgrammingWorkspace — unified tabs (Tasks | Motion | Analysis)', () => {
  it('renders the three tabs of the single programming workspace', () => {
    renderWorkspace()
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Motion' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Analysis' })).toBeInTheDocument()
  })

  it('Tasks is the default tab — the TaskEditor (Visual/Text) + Diagnostics', () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Program' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument()
    expect(screen.getByText(/No compile result/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Editor mode' })).toBeInTheDocument()
  })

  it('shows zero Scene editing UI in the programming workspace (SceneEditor lives in /scene)', () => {
    renderWorkspace()
    expect(screen.queryByText('Objects')).not.toBeInTheDocument()
    expect(screen.queryByText('Locations')).not.toBeInTheDocument()
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
    expect(screen.queryByText(/objects · locations · tools · home/i)).not.toBeInTheDocument()
  })

  it('switches to the Motion tab (PlanningPanel + TrajectoryColorPicker)', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }))
    expect(screen.getByRole('heading', { name: 'Trajectory Color' })).toBeInTheDocument()
    expect(screen.getByText(/No segments\. Add a motion command/)).toBeInTheDocument()
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
