// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { ProgramView } from './program-view'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import type { SegmentInfo, ActivePlan } from '@/features/viewport/types'

/**
 * CDD step 3 — ProgramView edit trigger: the minimal program-level editing
 * circuit. Pins:
 * - an Edit button per segment (disabled for MoveL — full-pose editing is
 *   deferred);
 * - editing a MoveLPosition target_position builds the correct semantic
 *   `ReplaceSegment` ProgramEdit and refreshes the scene through the SAME
 *   pattern as RecommendationRow (loadScene + applyScene);
 * - health before→after feedback;
 * - Undo calls planAnalysisApi.undo() and refreshes the scene again.
 */

const apiMocks = vi.hoisted(() => ({
  editProgram: vi.fn(),
  undo: vi.fn(),
}))

vi.mock('@/features/analysis/api/plan-analysis-api', () => ({
  planAnalysisApi: {
    editProgram: apiMocks.editProgram,
    undo: apiMocks.undo,
  },
}))

const loadSceneMocks = vi.hoisted(() => ({
  loadScene: vi.fn(),
}))

vi.mock('@/features/viewport/services/scene.service', () => ({
  sceneService: {
    loadScene: loadSceneMocks.loadScene,
  },
}))

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

const applyResponse = {
  recommendation_id: 0,
  plan_id: 'plan-2',
  health_before: 0.5,
  health_after: 0.62,
  improvement: 0.12,
  history_length: 1,
}

const undoResponse = {
  plan_id: 'plan-1',
  health_before: 0.62,
  health_after: 0.5,
  improvement: -0.12,
  history_length: 0,
}

beforeEach(() => {
  act(() => {
    useAnalysisStore.getState().clear()
    useSceneStore.getState().reset()
    useSceneStore.setState({ activePlan: makePlan() })
  })
  apiMocks.editProgram.mockReset()
  apiMocks.undo.mockReset()
  loadSceneMocks.loadScene.mockReset()
  loadSceneMocks.loadScene.mockResolvedValue({
    scene: {},
    runtime: { robot: { id: 'scara' }, joints: [], generatedAt: '' },
    ikResult: null,
    activePlan: { ...makePlan(), planId: 'plan-3' },
    activeTcp: null,
    execution: null,
  })
})

afterEach(() => cleanup())

describe('ProgramView — step 3 edit trigger', () => {
  it('renders an Edit button per segment, disabled for MoveL', () => {
    render(<ProgramView />)

    expect(screen.getByTestId('program-edit-0')).toBeEnabled()
    expect(screen.getByTestId('program-edit-2')).toBeEnabled()
    expect(screen.getByTestId('program-edit-1')).toBeDisabled()
  })

  it('editing a MoveLPosition target_position builds the ReplaceSegment ProgramEdit and refreshes the scene', async () => {
    apiMocks.editProgram.mockResolvedValue(applyResponse)
    render(<ProgramView />)

    fireEvent.click(screen.getByTestId('program-edit-2'))
    expect(screen.getByTestId('program-edit-form-2')).toBeInTheDocument()

    // x input (index 0 of the draft) starts at 2.5 → set to 3.0.
    fireEvent.change(screen.getByTestId('program-edit-input-2-0'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('program-edit-save-2'))

    await waitFor(() => {
      expect(apiMocks.editProgram).toHaveBeenCalledTimes(1)
    })
    expect(apiMocks.editProgram).toHaveBeenCalledWith({
      ReplaceSegment: {
        index: 2,
        replacement: [
          { MoveLPosition: { origin: 'base', frame: { Id: 3 }, target_position: [3, 1, -0.5], max_velocity: null } },
        ],
      },
    })

    // The scene refresh is the SAME pattern as RecommendationRow: loadScene
    // then applyScene into the viewport store.
    expect(loadSceneMocks.loadScene).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(useSceneStore.getState().activePlan?.planId).toBe('plan-3')
    })
  })

  it('shows health before→after feedback after the apply', async () => {
    apiMocks.editProgram.mockResolvedValue(applyResponse)
    render(<ProgramView />)

    fireEvent.click(screen.getByTestId('program-edit-2'))
    fireEvent.change(screen.getByTestId('program-edit-input-2-0'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('program-edit-save-2'))

    const feedback = await screen.findByTestId('program-edit-feedback')
    expect(feedback).toHaveTextContent('Applied')
    expect(feedback).toHaveTextContent('plan-2')
    expect(feedback).toHaveTextContent('Health 50% → 62%')
  })

  it('undo calls planAnalysisApi.undo() and refreshes the scene', async () => {
    apiMocks.editProgram.mockResolvedValue(applyResponse)
    apiMocks.undo.mockResolvedValue(undoResponse)
    render(<ProgramView />)

    // Apply an edit so the Undo button is available.
    fireEvent.click(screen.getByTestId('program-edit-2'))
    fireEvent.change(screen.getByTestId('program-edit-input-2-0'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('program-edit-save-2'))
    await screen.findByTestId('program-edit-feedback')

    fireEvent.click(screen.getByTestId('program-edit-undo'))

    await waitFor(() => {
      expect(apiMocks.undo).toHaveBeenCalledTimes(1)
      expect(apiMocks.undo).toHaveBeenCalledWith()
    })
    // Second scene refresh (loadScene already called once by the apply).
    expect(loadSceneMocks.loadScene).toHaveBeenCalledTimes(2)
    // Feedback is cleared after the undo.
    expect(screen.queryByTestId('program-edit-feedback')).not.toBeInTheDocument()
  })

  it('editing a MoveJ target builds a MoveWaypoint ProgramEdit', async () => {
    apiMocks.editProgram.mockResolvedValue(applyResponse)
    render(<ProgramView />)

    fireEvent.click(screen.getByTestId('program-edit-0'))
    expect(screen.getByTestId('program-edit-form-0')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('program-edit-input-0-0'), { target: { value: '0.4' } })
    fireEvent.click(screen.getByTestId('program-edit-save-0'))

    await waitFor(() => {
      expect(apiMocks.editProgram).toHaveBeenCalledTimes(1)
    })
    expect(apiMocks.editProgram).toHaveBeenCalledWith({
      MoveWaypoint: {
        segment_index: 0,
        new_target: [0.4, 0.2, 0.3],
        old_target: [0.1, 0.2, 0.3],
      },
    })
  })
})
