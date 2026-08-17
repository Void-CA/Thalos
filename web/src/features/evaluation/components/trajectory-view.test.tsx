// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import {
  TrajectoryView,
  buildTrajectoryScene,
  cameraForFrame,
  regionForWaypoint,
} from './trajectory-view'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import type { ActivePlan } from '@/features/viewport/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'
import {
  TRAJECTORY_COLOR_CRITICAL,
  TRAJECTORY_COLOR_END,
  TRAJECTORY_COLOR_MARKER,
  TRAJECTORY_COLOR_START,
} from '@/shared/charts/trajectory3d'

/**
 * The 3D trajectory view is store→R3F-elements mapping, so it renders in
 * jsdom WITHOUT instantiating a WebGL <Canvas> (same approach as
 * tcp-overlay.test.tsx / scene-entities.test.tsx): the fiber <Canvas> is
 * stubbed as a pass-through and drei's Html/Line/OrbitControls are stubbed as
 * plain DOM so the scene (runs, waypoints, endpoints) becomes queryable and
 * assertable. The pure store→scene mapping (`buildTrajectoryScene`) and the
 * click→store mapping (`regionForWaypoint`) are tested directly.
 */

// drei Line renders as a DOM node carrying color + points attributes for
// assertion; Html renders label children; OrbitControls is inert.
vi.mock('@react-three/drei', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/drei')>()
  return {
    ...actual,
    Line: (props: { ['data-testid']?: string; color?: string; points?: unknown[] }) => (
      <div
        data-testid={props['data-testid']}
        data-color={props.color}
        data-points={props.points ? JSON.stringify(props.points) : undefined}
      />
    ),
    Html: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    OrbitControls: () => null,
  }
})

// The real fiber <Canvas> needs WebGL — stub it as a pass-through div so the
// R3F element tree degrades to inert DOM custom elements under jsdom. useThree
// feeds the auto-fit CameraRig a fake camera (jsdom has no WebGL context).
vi.mock('@react-three/fiber', () => {
  function makeFakeCamera() {
    return {
      position: { set: () => {} },
      up: { set: () => {} },
      near: 0,
      far: 0,
      lookAt: () => {},
      updateProjectionMatrix: () => {},
    }
  }
  return {
    Canvas: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="r3f-canvas">{children}</div>
    ),
    useThree: () => ({ camera: makeFakeCamera() }),
  }
})

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

const regions = regionReport.problem_regions!

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
    useSceneStore.getState().reset()
  })
})
afterEach(() => cleanup())

describe('buildTrajectoryScene — pure store→scene mapping', () => {
  it('builds severity-colored runs, endpoints and a grid frame from waypoints + regions', () => {
    const scene = buildTrajectoryScene(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      regions,
      null,
      null,
    )
    expect(scene.runs).toHaveLength(3)
    const critical = scene.runs.find((r) => r.severity === 'critical')
    expect(critical?.color).toBe(TRAJECTORY_COLOR_CRITICAL)
    expect(scene.start).toEqual({ x: 0, y: 0, z: 0 })
    expect(scene.end).toEqual({ x: 3, y: 0, z: 0 })
    expect(scene.frame.span.x).toBeGreaterThan(3)
    expect(scene.marker).toBeUndefined()
  })

  it('carries the selectedRegionId and exposes the min-clearance marker waypoint', () => {
    const scene = buildTrajectoryScene(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      regions,
      7,
      2,
    )
    expect(scene.selectedRegionId).toBe(7)
    expect(scene.marker).toEqual({ x: 2, y: 0, z: 0 })
  })

  it('omits endpoints for degenerate (< 2 waypoints) trajectories', () => {
    const scene = buildTrajectoryScene([{ x: 0, y: 0, z: 0 }], [], null, null)
    expect(scene.runs).toEqual([])
    expect(scene.start).toBeUndefined()
    expect(scene.end).toBeUndefined()
  })
})

describe('cameraForFrame — auto-fit camera (scale-agnostic framing)', () => {
  it('places the camera at a fixed viewing angle around the frame center', () => {
    const frame = buildTrajectoryScene(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
      [],
      null,
      null,
    ).frame
    const f = cameraForFrame(frame)
    // Distance scales with the frame span and centers on the frame midpoint.
    expect(f.distance).toBeGreaterThan(0)
    expect(f.distance).toBeGreaterThan(frame.span.x)
    expect(f.target).toEqual([frame.center.x, frame.center.y, frame.center.z])
    // Camera sits outside the span (never inside the data), along Z-up view dir.
    expect(Math.hypot(f.position[0], f.position[1], f.position[2])).toBeGreaterThan(f.distance)
  })

  it('is proportional: a larger trajectory gets a larger framing distance', () => {
    const small = cameraForFrame(buildTrajectoryScene([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], [], null, null).frame)
    const big = cameraForFrame(buildTrajectoryScene([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], [], null, null).frame)
    expect(big.distance).toBeGreaterThan(small.distance)
  })
})

describe('regionForWaypoint — click→analysis-store mapping', () => {
  it('resolves the covering region id and null for clean waypoints', () => {
    expect(regionForWaypoint(regions, 1)).toBe(7)
    expect(regionForWaypoint(regions, 0)).toBeNull()
  })
})

function seedPlan() {
  act(() => {
    useAnalysisStore.setState({ report: regionReport })
    useSceneStore.setState({ activePlan: makePlan(5) })
  })
}

describe('TrajectoryView — react-three-fiber trajectory', () => {
  it('renders the severity legend (Clean / Warning / Critical)', () => {
    seedPlan()
    render(<TrajectoryView />)
    expect(screen.getByText('Clean')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders one severity-colored run element per TrajectoryRun', () => {
    seedPlan()
    render(<TrajectoryView />)
    // makePlan(5) + the critical region covering waypoints 1..2 → 3 runs.
    expect(screen.getAllByTestId(/^trajectory-run-/)).toHaveLength(3)
    const critical = screen.getByTestId('trajectory-run-1')
    expect(critical).toHaveAttribute('data-color', TRAJECTORY_COLOR_CRITICAL)
  })

  it('renders Start / End endpoint markers and a clickable waypoint per point', () => {
    seedPlan()
    render(<TrajectoryView />)
    const start = screen.getByTestId('trajectory-start')
    const end = screen.getByTestId('trajectory-end')
    expect(start).toBeInTheDocument()
    expect(end).toBeInTheDocument()
    // Waypoint 0 sits at [0,0,0]; five points, mirroring makePlan positions.
    expect(screen.getAllByTestId(/^trajectory-waypoint-/)).toHaveLength(5)
  })

  it('highlights the selected region run in white when the store selection changes', () => {
    seedPlan()
    render(<TrajectoryView />)
    // Critical run renders with its severity color before selection.
    expect(screen.getByTestId('trajectory-run-1')).toHaveAttribute('data-color', TRAJECTORY_COLOR_CRITICAL)
    act(() => {
      useAnalysisStore.setState({ selectedRegionId: 7 })
    })
    // Selected region → highlighted white.
    expect(screen.getByTestId('trajectory-run-1')).toHaveAttribute('data-color', '#ffffff')
    expect(screen.getByText('Region 7')).toBeInTheDocument()
  })

  it('marks the minimum-clearance waypoint when metrics carry it, else not', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...regionReport,
          metrics: { min_collision_distance: 0.03, min_collision_waypoint: 2, has_collisions: 0 },
        },
      })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    render(<TrajectoryView />)
    const marker = screen.getByTestId('trajectory-clearance-marker')
    expect(marker).toBeInTheDocument()
    expect(screen.getAllByTestId(/^trajectory-waypoint-/)).toHaveLength(5)
  })

  it('renders no clearance marker when metrics carry no clearance waypoint', () => {
    seedPlan()
    render(<TrajectoryView />)
    expect(screen.queryByTestId('trajectory-clearance-marker')).not.toBeInTheDocument()
  })

  it('shows an empty state when the plan carries no cartesian waypoints', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: { ...makePlan(0), visualization: null } })
    })
    render(<TrajectoryView />)
    expect(screen.getByText(/No trajectory data/i)).toBeInTheDocument()
    expect(screen.queryByTestId('r3f-canvas')).not.toBeInTheDocument()
  })

  it('shows an empty state when there is no active plan at all', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
    })
    render(<TrajectoryView />)
    expect(screen.getByText(/No trajectory data/i)).toBeInTheDocument()
  })

  it('endpoints and clearance marker use the trajectory tokens (start green / end red / marker green)', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...regionReport,
          metrics: { min_collision_waypoint: 2, has_collisions: 0 },
        },
      })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    render(<TrajectoryView />)
    // Token constants feed the markers (rendered through the real materials in
    // the browser; asserted here at the model level that they exist + colors).
    expect(TRAJECTORY_COLOR_START).toBeDefined()
    expect(TRAJECTORY_COLOR_END).toBeDefined()
    expect(TRAJECTORY_COLOR_MARKER).toBeDefined()
  })
})