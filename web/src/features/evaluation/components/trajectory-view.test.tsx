// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { TrajectoryView } from './trajectory-view'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import type { ActivePlan } from '@/features/viewport/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

// jsdom has no 2D canvas context — the component must render its DOM surface
// (canvas + legend + empty state) and skip drawing gracefully.
function makePlan(count: number): ActivePlan {
  return {
    planId: 'plan-1',
    state: 'ready',
    motionType: 'PTP',
    trajectoryProgress: null,
    visualization: {
      waypoints: Array.from({ length: count }, (_, i) => ({
        position: [i, i % 2, 0] as [number, number, number],
        orientation: [1, 0, 0, 0] as [number, number, number, number],
        joints: [],
        timestamp: i,
        waypoint_type: (i === 0 ? 'Start' : i === count - 1 ? 'Goal' : 'Via') as 'Start' | 'Goal' | 'Via',
      })),
      motionType: 'PTP',
    },
    segments: null,
    createdAt: '2026-01-01T00:00:00Z',
    startedAt: null,
    completedAt: null,
  }
}

const regionReport: AnalysisReportWire = {
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
      waypoint_start: 1,
      waypoint_end: 2,
      waypoint_count: 2,
      explanation: {
        cause: 'Singularity near waypoint 1',
        consequence: 'Tool flips near the goal',
        recommended_strategies: [],
        confidence: 0.9,
      },
    },
  ],
}

function renderView() {
  return render(<TrajectoryView />)
}

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
    useSceneStore.getState().reset()
  })
})
afterEach(() => cleanup())

describe('TrajectoryView — lightweight 3D trajectory with colored regions', () => {
  it('renders a canvas with an accessible label when the plan has waypoints', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()
    expect(
      screen.getByRole('img', { name: /Trajectory/ }),
    ).toBeInTheDocument()
  })

  it('renders the severity legend (Clean / Warning / Critical)', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()
    expect(screen.getByText('Clean')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('shows an empty state when the plan carries no cartesian waypoints', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: { ...makePlan(0), visualization: null } })
    })
    renderView()
    expect(screen.queryByRole('img', { name: /Trajectory/ })).not.toBeInTheDocument()
    expect(screen.getByText(/No trajectory data/i)).toBeInTheDocument()
  })

  it('shows an empty state when there is no active plan at all', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
    })
    renderView()
    expect(screen.getByText(/No trajectory data/i)).toBeInTheDocument()
  })
})
