// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowState } from './use-workflow-state'
import { useSemanticEditor } from '@/features/semantic/store'
import { useSceneStore } from '@/features/viewport/store'
import { useDomainSceneStore } from '@/features/scene/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'

const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

beforeEach(() => {
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  // The domain scene store has no reset action — restore the canonical seed
  // (1 bolt + valid default home pose) so sceneValid starts true once a robot
  // is loaded, and mutations never leak across tests.
  useDomainSceneStore.setState({
    objects: [{ id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } }],
    homePose: { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] },
  })
})

describe('useWorkflowState — selector hook over the real stores', () => {
  it('derives flags from store state and re-derives on store mutations', () => {
    const { result } = renderHook(() => useWorkflowState())

    // Viewport store holds no robot → the artifact chain is invalid: sceneValid
    // and programValid are false even though the editor is pre-seeded.
    expect(result.current.robotLoaded).toBe(false)
    expect(result.current.sceneValid).toBe(false)
    expect(result.current.programValid).toBe(false)
    expect(result.current.compiled).toBe(false)

    // A scene (robot) arrives → robotLoaded flips, and the seeded objects +
    // default home pose make the whole chain valid.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
    })
    expect(result.current.robotLoaded).toBe(true)
    expect(result.current.sceneValid).toBe(true)
    expect(result.current.programValid).toBe(true)

    // Successful compile → dirty resets → compiled flips true.
    act(() => {
      useSemanticEditor.getState().setResult(compileResult)
    })
    expect(result.current.compiled).toBe(true)

    // Editing an operation bumps dirty → compiled invalidates reactively.
    act(() => {
      useSemanticEditor.getState().updateOperation(0, { object: 'tray-1' })
    })
    expect(result.current.compiled).toBe(false)
  })

  it('carries scene.validHomePose from the domain scene store into sceneValid', () => {
    const { result } = renderHook(() => useWorkflowState())
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
    })
    expect(result.current.sceneValid).toBe(true)

    // A malformed home pose (non-finite component) invalidates the scene.
    act(() => {
      useDomainSceneStore.setState({
        homePose: { position: [1.8, 0.0, Number.NaN], orientation: [0, 0, 0, 1] },
      })
    })
    expect(result.current.sceneValid).toBe(false)
    // And the chain invalidates downstream: no valid scene → no valid program.
    expect(result.current.programValid).toBe(false)
  })

  it('imports the domain scene store without naming collision (area-scene spec)', () => {
    // Both stores coexist under distinct names in the same scope: the
    // viewport store (robotLoaded) and the renamed domain scene store.
    expect(useDomainSceneStore).toBeDefined()
    expect(useSceneStore).toBeDefined()
    expect(useDomainSceneStore).not.toBe(useSceneStore)
  })
})
