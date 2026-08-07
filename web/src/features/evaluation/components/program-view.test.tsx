// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { ProgramView } from './program-view'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import type { SegmentInfo } from '@/features/viewport/types'
import type { ActivePlan } from '@/features/viewport/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * ProgramView — structured, non-editable view of the active plan's motion
 * program (CDD step 2, /evaluation). Pins the wire->view contract:
 * - one row per segment (MoveJ / MoveL / MoveLPosition) with index, compact
 *   source summary, waypoint range and a severity badge when the segment's
 *   waypoint interval overlaps a problem region;
 * - the segment overlapping the SELECTED region gets a highlight;
 * - clicking a segment selects the overlapping region (and vice versa);
 * - empty state when the active plan carries no segments.
 */

const segments: SegmentInfo[] = [
  {
    segmentIndex: 0,
    motionType: 'PTP',
    waypointStart: 0,
    waypointEnd: 1,
    timeStart: 0,
    timeEnd: 1,
    source: { MoveJ: { origin: 'base', target: [0.1, 0.2, 0.3], max_velocity: null, max_acceleration: null } },
  },
  {
    segmentIndex: 1,
    motionType: 'LINE',
    waypointStart: 3,
    waypointEnd: 4,
    timeStart: 1,
    timeEnd: 2,
    source: {
      MoveL: {
        origin: 'base',
        frame: 'World',
        target_pose: {
          reference: 'World',
          target: 'World',
          transform: {
            translation: { x: 1.25, y: -0.5, z: 0.75 },
            rotation: { q: { w: 1, x: 0, y: 0, z: 0 } },
          },
        },
        max_velocity: null,
      },
    },
  },
  {
    segmentIndex: 2,
    motionType: 'LINE',
    waypointStart: 7,
    waypointEnd: 8,
    timeStart: 2,
    timeEnd: 3,
    source: {
      MoveLPosition: { origin: 'base', frame: { Id: 3 }, target_position: [2.5, 1.0, -0.5], max_velocity: null },
    },
  },
]

function makePlan(): ActivePlan {
  return {
    planId: 'plan-1',
    state: 'ready',
    motionType: 'PTP',
    trajectoryProgress: null,
    visualization: null,
    segments,
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
    { id: 7, kind: 'singularity', severity: 'critical', waypoint_start: 3, waypoint_end: 4, waypoint_count: 2 },
    { id: 9, kind: 'low_clearance', severity: 'warning', waypoint_start: 7, waypoint_end: 8, waypoint_count: 2 },
  ],
}

function renderView() {
  return render(<ProgramView />)
}

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
    useSceneStore.getState().reset()
  })
})
afterEach(() => cleanup())

describe('ProgramView — structured program list', () => {
  it('renders one row per segment with its type, index, source summary and waypoint range', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan() })
    })
    renderView()

    const seg0 = screen.getByTestId('program-segment-0')
    expect(seg0).toHaveTextContent('[0]')
    expect(seg0).toHaveTextContent('MoveJ')
    expect(seg0).toHaveTextContent('[0.10, 0.20, 0.30]')
    expect(seg0).toHaveTextContent('wp0–wp1')

    const seg1 = screen.getByTestId('program-segment-1')
    expect(seg1).toHaveTextContent('[1]')
    expect(seg1).toHaveTextContent('MoveL')
    expect(seg1).toHaveTextContent('World [1.25, -0.50, 0.75]')
    expect(seg1).toHaveTextContent('wp3–wp4')

    const seg2 = screen.getByTestId('program-segment-2')
    expect(seg2).toHaveTextContent('[2]')
    expect(seg2).toHaveTextContent('MoveLPosition')
    expect(seg2).toHaveTextContent('#3 [2.50, 1.00, -0.50]')
    expect(seg2).toHaveTextContent('wp7–wp8')
  })

  it('shows a severity badge on segments overlapping a problem region, absent on clean ones', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan() })
    })
    renderView()

    expect(screen.getAllByTestId('severity-badge')).toHaveLength(2)
    expect(screen.getByTestId('program-segment-1')).toHaveAttribute('data-severity', 'critical')
    expect(screen.getByTestId('program-segment-1')).toHaveTextContent('Critical')
    expect(screen.getByTestId('program-segment-2')).toHaveAttribute('data-severity', 'warning')
    expect(screen.getByTestId('program-segment-2')).toHaveTextContent('Warning')
    expect(screen.getByTestId('program-segment-0')).not.toHaveAttribute('data-severity')
  })

  it('highlights the segment overlapping the selected region', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport, selectedRegionId: 7 })
      useSceneStore.setState({ activePlan: makePlan() })
    })
    renderView()

    const seg1 = screen.getByTestId('program-segment-1')
    expect(seg1).toHaveAttribute('data-selected', 'true')
    expect(seg1.className).toContain('ring-primary-mid')
    expect(screen.getByTestId('program-segment-0')).not.toHaveAttribute('data-selected')
    expect(screen.getByTestId('program-segment-2')).not.toHaveAttribute('data-selected')

    act(() => {
      useAnalysisStore.setState({ selectedRegionId: 9 })
    })
    expect(screen.getByTestId('program-segment-2')).toHaveAttribute('data-selected', 'true')
    expect(seg1).not.toHaveAttribute('data-selected')
  })

  it('selects the overlapping region on click, toggles it off on re-click, and clears on a clean segment', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan() })
    })
    renderView()

    fireEvent.click(screen.getByTestId('program-segment-1'))
    expect(useAnalysisStore.getState().selectedRegionId).toBe(7)

    fireEvent.click(screen.getByTestId('program-segment-1'))
    expect(useAnalysisStore.getState().selectedRegionId).toBeNull()

    fireEvent.click(screen.getByTestId('program-segment-2'))
    expect(useAnalysisStore.getState().selectedRegionId).toBe(9)

    fireEvent.click(screen.getByTestId('program-segment-0'))
    expect(useAnalysisStore.getState().selectedRegionId).toBeNull()
  })

  it('renders an empty state when the active plan carries no segments', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: { ...makePlan(), segments: null } })
    })
    renderView()

    expect(screen.getByTestId('program-empty')).toBeInTheDocument()
    expect(screen.getByText(/No program segments/i)).toBeInTheDocument()
  })

  it('renders clean segments without badges when the report has no regions', () => {
    const clean = { ...regionReport, problem_regions: [] }
    act(() => {
      useAnalysisStore.setState({ report: clean })
      useSceneStore.setState({ activePlan: makePlan() })
    })
    renderView()

    expect(screen.getAllByTestId('program-segment-0')).toHaveLength(1)
    expect(screen.queryByTestId('severity-badge')).not.toBeInTheDocument()
  })
})
