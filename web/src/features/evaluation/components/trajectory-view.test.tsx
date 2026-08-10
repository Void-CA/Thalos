// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { TrajectoryView } from './trajectory-view'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import { installCanvasMock } from '@/test/canvas-mock'
import type { ActivePlan } from '@/features/viewport/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

// echarts-gl needs a WebGL context that jsdom cannot provide. The GL frontier
// mount/resize/dispose are stubbed; the real `buildTrajectoryOption` stays
// live so the tests assert on the option the component actually mounts.
const gl = vi.hoisted(() => ({
  mountGLChart: vi.fn((_el: HTMLElement, _option: unknown) => ({ on: vi.fn(), off: vi.fn() })),
  resizeGLChart: vi.fn(),
  disposeGLChart: vi.fn(),
}))

vi.mock('@/shared/charts/gl-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/charts/gl-adapter')>()
  return {
    ...actual,
    mountGLChart: gl.mountGLChart,
    resizeGLChart: gl.resizeGLChart,
    disposeGLChart: gl.disposeGLChart,
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

function renderView() {
  return render(<TrajectoryView />)
}

beforeEach(() => {
  installCanvasMock()
  gl.mountGLChart.mockClear()
  gl.resizeGLChart.mockClear()
  gl.disposeGLChart.mockClear()
  act(() => {
    useAnalysisStore.getState().clear()
    useSceneStore.getState().reset()
  })
})
afterEach(() => cleanup())

describe('TrajectoryView — ECharts GL line3D trajectory', () => {
  it('mounts a line3D chart with the severity-colored series when waypoints exist', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()

    expect(gl.mountGLChart).toHaveBeenCalledTimes(1)
    const option = gl.mountGLChart.mock.calls[0][1] as {
      series: Array<{ type: string; lineStyle?: { color?: string } }>
    }
    expect(option.series.some((s) => s.type === 'line3D')).toBe(true)
    const critical = option.series.find((s) => s.lineStyle?.color === '#ef4444')
    expect(critical).toBeTruthy()
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

  it('wires line3D click picking to the analysis store selection', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()

    const chart = gl.mountGLChart.mock.results[0].value
    const onMock = chart.on as ReturnType<typeof vi.fn>
    expect(onMock).toHaveBeenCalledWith('click', expect.any(Function))
    const clickHandler = onMock.mock.calls[0][1]

    // Region 7 covers waypoints 1..2 → clicking the critical run selects it.
    act(() => clickHandler({ seriesIndex: 1, dataIndex: 0 }))
    expect(useAnalysisStore.getState().selectedRegionId).toBe(7)

    // Clicking a clean run clears the selection.
    act(() => clickHandler({ seriesIndex: 0, dataIndex: 0 }))
    expect(useAnalysisStore.getState().selectedRegionId).toBeNull()
  })

  it('re-mounts highlighting the selected region in white when the store selection changes', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()
    act(() => {
      useAnalysisStore.setState({ selectedRegionId: 7 })
    })

    const last = gl.mountGLChart.mock.calls.at(-1)!
    const option = last[1] as { series: Array<{ lineStyle?: { color?: string } }> }
    expect(option.series.some((s) => s.lineStyle?.color === '#ffffff')).toBe(true)
  })

  it('marks the minimum-clearance waypoint with a scatter3D series when metrics carry it', () => {
    act(() => {
      useAnalysisStore.setState({
        report: {
          ...regionReport,
          metrics: { min_collision_distance: 0.03, min_collision_waypoint: 2, has_collisions: 0 },
        },
      })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()

    const option = gl.mountGLChart.mock.calls[0][1] as {
      series: Array<{ type: string; data?: unknown[] }>
    }
    const marker = option.series.find((s) => s.type === 'scatter3D')
    expect(marker).toBeTruthy()
    // makePlan waypoint 2 sits at [2, 0, 0].
    expect(marker?.data).toEqual([[2, 0, 0]])
  })

  it('emits no marker when the report metrics carry no clearance waypoint', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: makePlan(5) })
    })
    renderView()

    const option = gl.mountGLChart.mock.calls[0][1] as { series: Array<{ type: string }> }
    expect(option.series.some((s) => s.type === 'scatter3D')).toBe(false)
  })

  it('shows an empty state when the plan carries no cartesian waypoints', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
      useSceneStore.setState({ activePlan: { ...makePlan(0), visualization: null } })
    })
    renderView()
    expect(gl.mountGLChart).not.toHaveBeenCalled()
    expect(screen.getByText(/No trajectory data/i)).toBeInTheDocument()
  })

  it('shows an empty state when there is no active plan at all', () => {
    act(() => {
      useAnalysisStore.setState({ report: regionReport })
    })
    renderView()
    expect(gl.mountGLChart).not.toHaveBeenCalled()
    expect(screen.getByText(/No trajectory data/i)).toBeInTheDocument()
  })
})
