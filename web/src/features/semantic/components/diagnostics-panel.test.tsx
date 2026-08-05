// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { DiagnosticsPanel } from './diagnostics-panel'
import { useSemanticEditor } from '../store'
import { useSceneStore } from '@/features/viewport/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '../types'

/** Compiled result with a 2-instruction program — mirrors the backend wire
 *  (move_l + delay). */
const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 2 },
  motion_program: {
    instructions: [
      {
        type: 'move_l',
        origin: 'op_2',
        target: { type: 'pose', position: [1, 2, 3], orientation: [0, 0, 0, 1], frame: 'world' },
        profile: { max_velocity: 250, max_acceleration: 500, max_jerk: null },
      },
      { type: 'delay', origin: 'op_3', duration: { secs: 2, nanos: 0 } },
    ],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

beforeEach(() => {
  act(() => {
    // robotLoaded (sceneStore.data) gates sceneValid → compiled.
    useSceneStore.setState({ data: {} as SceneData })
    useSemanticEditor.getState().reset()
    useSemanticEditor.setState({ result: compileResult, dirty: 0 })
  })
})
afterEach(() => cleanup())

describe('DiagnosticsPanel — CompiledInstructions integration (compiled-instructions-view spec R2)', () => {
  it('renders the compiled instruction list below the instruction count', () => {
    render(<DiagnosticsPanel />)

    const panel = screen.getByRole('region', { name: 'Diagnostics' })
    expect(panel).toHaveTextContent('2 instructions')
    expect(panel).toHaveTextContent('op_2 move_l → [1, 2, 3]')
    expect(panel).toHaveTextContent('delay 2.0s')
  })

  it('renders the "No instructions" empty state when the program is empty', () => {
    act(() => {
      useSemanticEditor.setState({
        result: {
          ...compileResult,
          motion_program: {
            instructions: [],
            metadata: { schema_version: 1, source_project: 'test' },
          },
        },
      })
    })
    render(<DiagnosticsPanel />)

    const panel = screen.getByRole('region', { name: 'Diagnostics' })
    expect(panel).toHaveTextContent('2 instructions')
    expect(panel).toHaveTextContent('No instructions')
  })
})
