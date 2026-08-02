// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkflowState } from './use-workflow-state'
import { useSemanticEditor } from '@/features/semantic/store'
import { useSceneStore } from '@/features/viewport/store'
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
})

describe('useWorkflowState — selector hook over the real stores', () => {
  it('derives flags from store state and re-derives on store mutations', () => {
    const { result } = renderHook(() => useWorkflowState())

    // Viewport store holds no robot → not loaded; semantic editor has a
    // seeded program but no compile result → taskValid, not compiled.
    expect(result.current.robotLoaded).toBe(false)
    expect(result.current.taskValid).toBe(true)
    expect(result.current.compiled).toBe(false)

    // A scene (robot) arrives → robotLoaded flips.
    act(() => {
      useSceneStore.setState({ data: {} as SceneData })
    })
    expect(result.current.robotLoaded).toBe(true)

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
})
