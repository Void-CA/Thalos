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
 * ProgrammingWorkspace — the UNIFIED programming area (hotfix: /task +
 * /planning merged into ONE workspace under /task, stage 3). The ways to
 * author an order — semantic editor in visual mode (Task), motion program by
 * segments (Motion), and the semantic editor in TEXT mode (Code) — are tabs
 * of the same workspace, communicating that they are ONE interaction medium.
 *
 * HOTFIX (evaluation-workspace): the Analysis tab was REMOVED — the analysis
 * check is now the /evaluation VISTA. This suite pins the three-tab layout.
 */

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

describe('ProgrammingWorkspace — unified tabs (Task | Motion | Code)', () => {
  it('renders the three authoring tabs — the analysis tab is gone (moved to /evaluation)', () => {
    renderWorkspace()
    expect(screen.getByRole('tab', { name: 'Task' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Motion' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Code' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Analysis' })).not.toBeInTheDocument()
  })

  it('Task is the default tab — the TaskEditor (visual mode) + Diagnostics', () => {
    renderWorkspace()
    // TaskEditor presence: the unified compile action + operation rows.
    expect(screen.getByRole('button', { name: 'Compile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument()
    expect(screen.getByText(/No compile result/)).toBeInTheDocument()
  })

  it('Code tab mounts the TaskEditor in text mode — canonical textarea, no rows', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    const textarea = screen.getByTestId('program-textarea') as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.value).toBe('pick bolt-1\nwait 1s\nplace bolt-1 at tray-1\nhome')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
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

  it('renders NO analysis content inside the programming workspace anymore', () => {
    renderWorkspace()
    // Neither the AdvisorSection null-state nor the AnalysisSection empty
    // state renders — the evaluation view owns that content now.
    expect(screen.queryByText('No analysis available')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Compile and preview a motion program to see analysis/),
    ).not.toBeInTheDocument()
  })

  it('a report in the store does NOT resurrect an Analysis tab', () => {
    act(() => {
      useAnalysisStore.setState({ report })
    })
    renderWorkspace()
    expect(screen.queryByRole('tab', { name: 'Analysis' })).not.toBeInTheDocument()
  })

  it('R6 — separates the three visual layers into distinct containers: feedback (PipelineStatus), navigation (tabs), commands (toolbar)', () => {
    renderWorkspace()
    const feedback = document.querySelector('[data-layer="feedback"]')
    const navigation = document.querySelector('[data-layer="navigation"]')
    const commands = document.querySelector('[data-layer="commands"]')
    // All three layers render.
    expect(feedback).not.toBeNull()
    expect(navigation).not.toBeNull()
    expect(commands).not.toBeNull()
    // No layer is merged into another — each keeps its own container so the
    // styling can differentiate tabs (navigation) from PipelineStatus
    // (feedback) from command buttons (actions).
    expect(feedback).not.toBe(navigation)
    expect(navigation).not.toBe(commands)
  })
})

describe('ProgrammingWorkspace — tab-switch guard (task-code-sync-guards spec)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('warns "Uncommitted changes will be lost" when leaving Code with an uncommitted buffer; cancel keeps the tab', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    fireEvent.change(screen.getByTestId('program-textarea'), {
      target: { value: 'pick bolt-1\nwait 2s\nhome' },
    })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('tab', { name: 'Task' }))

    // The warning is shown, and declining the discard keeps the Code editor
    // mounted with the buffer untouched (spec "Cancel preserves buffer").
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Uncommitted changes will be lost'),
    )
    expect(screen.getByTestId('program-textarea')).toBeInTheDocument()
    expect((screen.getByTestId('program-textarea') as HTMLTextAreaElement).value).toBe(
      'pick bolt-1\nwait 2s\nhome',
    )
  })

  it('discards and switches after confirmation', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    fireEvent.change(screen.getByTestId('program-textarea'), {
      target: { value: 'pick bolt-1\nwait 2s\nhome' },
    })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }))

    expect(confirmSpy).toHaveBeenCalled()
    // The switch completes: Motion panel renders, Code editor unmounts.
    expect(screen.getByRole('heading', { name: 'Trajectory Color' })).toBeInTheDocument()
    expect(screen.queryByTestId('program-textarea')).not.toBeInTheDocument()
  })

  it('switches without warning when the buffer is committed (or clean)', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    const confirmSpy = vi.spyOn(window, 'confirm')

    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Trajectory Color' })).toBeInTheDocument()
  })
})
