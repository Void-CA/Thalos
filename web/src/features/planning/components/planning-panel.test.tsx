// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanningPanel } from './planning-panel'
import { ApiError } from '@/shared/errors'
import { usePlanningStore, type SegmentModel } from '../store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useSceneStore } from '@/features/viewport/store'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * PR2 (motion-program spec "Preview success triggers receivePlan"): a
 * successful planning preview mirrors the plan into the execution store —
 * `receivePlan({instructionCount, durationSecs, source: 'Motion Program'})` —
 * WITHOUT touching the backend runtime and WITHOUT starting the tick loop
 * (execStatus = ready, never running). The backend is mocked; the assertion
 * is the observable execution-store state after clicking Preview.
 */

const sceneApiMocks = vi.hoisted(() => ({
  previewPlan: vi.fn(),
}))

vi.mock('@/features/viewport/api/scene-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewport/api/scene-api')>()
  return { ...actual, sceneApi: { ...actual.sceneApi, previewPlan: sceneApiMocks.previewPlan } }
})

const analysisApiMocks = vi.hoisted(() => ({
  analyze: vi.fn(),
}))

vi.mock('@/features/analysis/api/plan-analysis-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/analysis/api/plan-analysis-api')>()
  return { ...actual, planAnalysisApi: { ...actual.planAnalysisApi, analyze: analysisApiMocks.analyze } }
})

/** Preview response with 2 segments — the mirrored plan carries count + duration. */
const previewResponse: RuntimeStateResponse = {
  robot: { id: 'r1', display_name: 'R1', dof: 2, joints: [] },
  joints: [0, 0],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: {
    plan_id: 'p1',
    state: 'Ready',
    motion_type: 'PTP',
    trajectory_progress: null,
    visualization: null,
    segments: [
      {
        segment_index: 0,
        motion_type: 'PTP',
        waypoint_start: 0,
        waypoint_end: 1,
        time_start: 0,
        time_end: 2.5,
        source: { MoveJ: { origin: 'op-0', target: [0.5, 1.0], max_velocity: null, max_acceleration: null } },
      },
      {
        segment_index: 1,
        motion_type: 'PTP',
        waypoint_start: 1,
        waypoint_end: 2,
        time_start: 2.5,
        time_end: 5,
        source: {
          MoveL: {
            origin: 'op-1',
            frame: 'World',
            target_pose: {
              reference: 'World',
              target: { Id: 1 },
              transform: { translation: { x: 0.3, y: 0, z: 0 }, rotation: { q: { w: 1, x: 0, y: 0, z: 0 } } },
            },
            max_velocity: null,
          },
        },
      },
    ],
    created_at: '2026-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
  },
  active_tcp: null,
  execution: null,
  generated_at: '2026-01-01T00:00:00Z',
}

const analysisReport: AnalysisReportWire = {
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

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanningPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sceneApiMocks.previewPlan.mockReset()
  analysisApiMocks.analyze.mockReset()
  useExecutionStore.setState({ status: 'idle', activePlan: null, progress: 0, elapsedSecs: 0, error: null })
  act(() => {
    useSceneStore.setState({
      runtime: { robot: { id: 'r1', display_name: 'R1', dof: 2, joints: [] }, joints: [0, 0], generatedAt: '2026-01-01T00:00:00Z' },
      activePlan: null,
    })
    usePlanningStore.setState({
      segments: [
        {
          kind: 'movej', expanded: false, joints: [0.1, 0.2],
          txStr: '0.3', tyStr: '0', tzStr: '0', rotationFormat: 'euler',
          yawStr: '0', pitchStr: '0', rollStr: '0',
          qwStr: '1', qxStr: '0', qyStr: '0', qzStr: '0', velocityStr: '',
          moveLMode: 'pose',
        },
      ],
    })
  })
})
afterEach(() => cleanup())

describe('PlanningPanel — preview success mirrors the plan into the execution store (PR2)', () => {
  it('calls receivePlan({instructionCount, durationSecs, source: Motion Program}) on preview success', async () => {
    sceneApiMocks.previewPlan.mockResolvedValue(previewResponse)
    analysisApiMocks.analyze.mockResolvedValue(analysisReport)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(useExecutionStore.getState().activePlan).toEqual({
        instructionCount: 2,
        durationSecs: 5,
        source: 'Motion Program',
      })
    })
    // Handoff reception sets ready WITHOUT starting the tick loop (Invariant #5).
    expect(useExecutionStore.getState().status).toBe('ready')
  })

  it('does not call receivePlan when the preview fails', async () => {
    sceneApiMocks.previewPlan.mockRejectedValue(new Error('segment_0_failed'))
    analysisApiMocks.analyze.mockResolvedValue(analysisReport)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(sceneApiMocks.previewPlan).toHaveBeenCalledTimes(1)
    })
    expect(useExecutionStore.getState().activePlan).toBeNull()
    expect(useExecutionStore.getState().status).not.toBe('ready')
  })

  it('clears the stale Motion Program plan when a LATER preview fails (R4-002)', async () => {
    // Preview #1 succeeds → the plan is mirrored and the store turns ready.
    sceneApiMocks.previewPlan.mockResolvedValueOnce(previewResponse)
    analysisApiMocks.analyze.mockResolvedValue(analysisReport)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => {
      expect(useExecutionStore.getState().activePlan).toEqual({
        instructionCount: 2,
        durationSecs: 5,
        source: 'Motion Program',
      })
      expect(useExecutionStore.getState().status).toBe('ready')
    })

    // Preview #2 fails → the stale mirrored plan must NOT stay executable.
    sceneApiMocks.previewPlan.mockRejectedValueOnce(new Error('segment_1_failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(sceneApiMocks.previewPlan).toHaveBeenCalledTimes(2)
    })
    expect(useExecutionStore.getState().activePlan).toBeNull()
    expect(useExecutionStore.getState().status).not.toBe('ready')
  })
})

describe('PlanningPanel — Recompilar CTA on manifest validation error (PR1)', () => {
  it('shows a Recompilar button when the preview fails with semantic_validation_error', async () => {
    sceneApiMocks.previewPlan.mockRejectedValue(
      new ApiError('Segment 0 references unknown object', {
        code: 'semantic_validation_error',
        status: 422,
      }),
    )
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Recompilar' })).toBeInTheDocument()
    })
    // planReady is cleared: the failed plan is NOT mirrored executable.
    expect(useExecutionStore.getState().activePlan).toBeNull()
    expect(useExecutionStore.getState().status).not.toBe('ready')
  })

  it('clicking Recompilar re-runs the preview (compile button path)', async () => {
    sceneApiMocks.previewPlan.mockRejectedValueOnce(
      new ApiError('Segment 0 references unknown object', {
        code: 'semantic_validation_error',
        status: 422,
      }),
    )
    sceneApiMocks.previewPlan.mockResolvedValueOnce(previewResponse)
    analysisApiMocks.analyze.mockResolvedValue(analysisReport)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Recompilar' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Recompilar' }))

    await waitFor(() => {
      expect(sceneApiMocks.previewPlan).toHaveBeenCalledTimes(2)
      expect(useExecutionStore.getState().activePlan).toEqual({
        instructionCount: 2,
        durationSecs: 5,
        source: 'Motion Program',
      })
    })
  })
})

describe('PlanningPanel — MoveL position-only mode (CDD hotfix: moveL on SCARA)', () => {
  function movelSegment(moveLMode: 'position' | 'pose'): SegmentModel {
    return {
      kind: 'movel', expanded: true, joints: [],
      txStr: '0.6', tyStr: '0.5', tzStr: '0.25', rotationFormat: 'euler',
      yawStr: '0', pitchStr: '0', rollStr: '0',
      qwStr: '1', qxStr: '0', qyStr: '0', qzStr: '0', velocityStr: '',
      moveLMode,
    }
  }

  it('MoveLEditor shows a Position|Pose SegmentedControl', async () => {
    act(() => {
      usePlanningStore.setState({ segments: [movelSegment('pose')] })
    })
    renderPanel()

    expect(screen.getByRole('button', { name: 'Position' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pose' })).toBeInTheDocument()
  })

  it('position mode sends no rotation in buildRequest', async () => {
    sceneApiMocks.previewPlan.mockResolvedValue(previewResponse)
    analysisApiMocks.analyze.mockResolvedValue(analysisReport)
    act(() => {
      usePlanningStore.setState({ segments: [movelSegment('position')] })
    })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(sceneApiMocks.previewPlan).toHaveBeenCalledTimes(1)
    })
    const request = sceneApiMocks.previewPlan.mock.calls[0][0]
    const target = request.segments[0].target
    expect(target.translation).toEqual([0.6, 0.5, 0.25])
    expect('rotation' in target).toBe(false)
  })

  it('pose mode keeps sending rotation as before', async () => {
    sceneApiMocks.previewPlan.mockResolvedValue(previewResponse)
    analysisApiMocks.analyze.mockResolvedValue(analysisReport)
    act(() => {
      usePlanningStore.setState({ segments: [movelSegment('pose')] })
    })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(sceneApiMocks.previewPlan).toHaveBeenCalledTimes(1)
    })
    const request = sceneApiMocks.previewPlan.mock.calls[0][0]
    const target = request.segments[0].target
    expect('rotation' in target).toBe(true)
  })
})
