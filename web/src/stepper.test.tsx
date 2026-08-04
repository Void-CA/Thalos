// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import '@testing-library/jest-dom/vitest'
import { Stepper } from './stepper'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'
import type { PlanAnalysisResponse } from '@/features/analysis/api/plan-analysis.types'

/**
 * Integration tests for the global-stepper spec: the stepper renders the
 * workflow pipeline (Programación → Planificación → Ejecución → Sesiones) from
 * the registry, marks the active route, blocks navigation on unmet
 * requirements and shows the reason derived from the missing flag — never a
 * per-workspace hardcoded string. Labels are the registry domain vocabulary.
 *
 * The stepper is rendered inside a minimal memory router (it consumes
 * useLocation/useNavigate); the REAL workflow stores are seeded so the flags
 * come from the actual derivation layer.
 */
const compileResult: CompileResponse = {
  status: 'ok',
  validation: { errors: [], warnings: [] },
  metadata: { instruction_count: 4 },
  motion_program: {
    instructions: [],
    metadata: { schema_version: 1, source_project: 'test' },
  },
}

const analysisSummary: PlanAnalysisResponse['summary'] = {
  status: 'ok',
  score: 92,
  grade: 'Good',
  message: 'ok',
}

function seedFlags(opts: {
  robotLoaded?: boolean
  compiled?: boolean
  executable?: boolean
  completed?: boolean
  analyzed?: boolean
} = {}) {
  const {
    robotLoaded = true,
    compiled = false,
    executable = false,
    completed = false,
    analyzed = false,
  } = opts
  act(() => {
    useSceneStore.setState({ data: robotLoaded ? ({} as SceneData) : null })
    useSemanticEditor.setState({ result: compiled ? compileResult : null, dirty: 0 })
    useExecutionStore.setState({
      status: completed ? 'completed' : executable ? 'ready' : 'idle',
    })
    useAnalysisStore.setState({ summary: analyzed ? analysisSummary : null })
  })
}

function renderStepper(initialPath: string) {
  const router = createMemoryRouter([{ path: '*', element: <Stepper /> }], {
    initialEntries: [initialPath],
  })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ summary: null })
})
afterEach(() => cleanup())

describe('Stepper — workflow-driven stages (global-stepper spec)', () => {
  it('renders Programación, Planificación, Ejecución and Sesiones stages', () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true, completed: true, analyzed: true })
    renderStepper('/sessions')
    expect(screen.getByRole('button', { name: 'Programación' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Planificación' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ejecución' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sesiones' })).toBeInTheDocument()
  })

  it('excludes the robot root, the scene area and hidden support workspaces from the stages (4 stages until S3)', () => {
    seedFlags()
    renderStepper('/')
    expect(screen.queryByRole('button', { name: 'Robot' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escena' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Knowledge' })).not.toBeInTheDocument()
  })

  it('marks the active route stage as current (S4: I know where I am)', () => {
    seedFlags({ robotLoaded: true, compiled: true })
    renderStepper('/planning')
    expect(screen.getByRole('button', { name: 'Planificación' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Programación' })).not.toHaveAttribute('aria-current')
  })

  it('navigates when a future stage is clickable (requirements met)', async () => {
    seedFlags({ robotLoaded: true, compiled: true })
    const router = renderStepper('/task')
    fireEvent.click(screen.getByRole('button', { name: 'Planificación' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/planning'))
  })

  it('does not navigate on a blocked stage and shows the derived reason', async () => {
    seedFlags({ robotLoaded: true, compiled: true }) // executable=false
    const router = renderStepper('/task')
    const execution = screen.getByRole('button', { name: 'Ejecución' })
    expect(execution).toBeDisabled()
    expect(screen.getByText('Requires an executable plan')).toBeInTheDocument()
    fireEvent.click(execution)
    expect(router.state.location.pathname).toBe('/task')
  })

  it('derives a different blocked reason per missing flag (not a fixed string)', () => {
    seedFlags({ robotLoaded: true, compiled: true }) // executable=false, completed=false
    renderStepper('/planning')
    expect(screen.getByText('Requires an executable plan')).toBeInTheDocument()
    expect(screen.getByText('Requires a completed execution')).toBeInTheDocument()
  })

  it('shows future stages whose requirements are met as pending (S4: next step visible)', () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true, analyzed: true })
    renderStepper('/planning')
    const execution = screen.getByRole('button', { name: 'Ejecución' })
    expect(execution).not.toBeDisabled()
    expect(execution).not.toHaveAttribute('aria-current')
  })
})
