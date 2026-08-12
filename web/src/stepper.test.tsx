// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import '@testing-library/jest-dom/vitest'
import { Stepper } from './stepper'
import { stepperStages } from '@/shared/workflow/derive'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import type { WorkspaceEntry, WorkspaceName } from '@/shared/workflow/types'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * Integration tests for the global-stepper spec (delta MODIFIED — 6 stages:
 * the evaluation-workspace hotfix added Evaluation between Programming and
 * Execution; the unified programming workspace merged /planning into /task —
 * Programming is ONE step).
 *
 * The stepper renders the six domain pipeline stages Robot → Scene →
 * Programming → Evaluation → Execution → Sessions DERIVED from the area
 * registry (`stage` order — no parallel stage list, user criterion C1) and
 * marks each stage passed/current/pending/blocked purely from the
 * `WorkflowState` it consumes (C4 — it never re-derives store flags).
 * Availability and navigation are separate (C3): a blocked stage is visible
 * and shows its reason, but its click NEVER changes the area.
 *
 * The stepper is rendered inside a minimal memory router (it consumes
 * useLocation/useNavigate); the REAL workflow stores are seeded so the flags
 * come from the actual derivation layer. `useDomainSceneStore` ships seeded
 * with 1 object + a valid home pose, so `sceneValid` follows `robotLoaded`
 * in these tests. State markers are the spec glyphs (✓ passed / ● current /
 * ○ pending / ✕ blocked — the user-visible stage state contract).
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

const analysisReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.92,
    score: 92,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
}

const PIPELINE_LABELS = [
  'Robot',
  'Scene',
  'Programming',
  'Evaluation',
  'Execution',
  'Sessions',
] as const

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
    useAnalysisStore.setState({ report: analyzed ? analysisReport : null })
  })
}

function renderStepper(initialPath: string) {
  const router = createMemoryRouter([{ path: '*', element: <Stepper /> }], {
    initialEntries: [initialPath],
  })
  render(<RouterProvider router={router} />)
  return router
}

/** Stage order as rendered: button texts with the state glyph stripped. */
function renderedStageLabels(): string[] {
  return screen
    .getAllByRole('button')
    .map((b) => b.textContent?.replace(/[✓●○✕]/g, '').trim() ?? '')
}

/** Visible state marker of a stage button (STATE_GLYPH contract). */
function glyph(label: string): string {
  return screen.getByRole('button', { name: label }).textContent!.charAt(0)
}

beforeEach(() => {
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ report: null })
})
afterEach(() => cleanup())

describe('Stepper — six registry-derived stages (global-stepper spec S3)', () => {
  it('renders the six pipeline stages Robot → Scene → Programming → Evaluation → Execution → Sessions', () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true, completed: true, analyzed: true })
    renderStepper('/sessions')
    for (const label of PIPELINE_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // Planificación no longer exists — /planning was absorbed into /task.
    expect(screen.queryByRole('button', { name: 'Planificación' })).not.toBeInTheDocument()
  })

  it('orders the stages by registry stage (Robot=1 … Sessions=6), not by capability', () => {
    seedFlags({ robotLoaded: true, compiled: true })
    renderStepper('/task')
    expect(renderedStageLabels()).toEqual([
      'Robot',
      'Scene',
      'Programming',
      'Evaluation',
      'Execution',
      'Sessions',
    ])
  })

  it('starts the stepper at Robot (stage 1), never at Scene or Programming', () => {
    seedFlags({ robotLoaded: true })
    renderStepper('/scene')
    const labels = renderedStageLabels()
    expect(labels[0]).toBe('Robot')
    expect(labels[1]).toBe('Scene')
  })

  it('marks each stage passed/current/pending/blocked from the derived WorkflowState (spec progress scenario)', () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true, analyzed: true })
    renderStepper('/task')
    expect(glyph('Robot')).toBe('✓') // passed — robotLoaded produced
    expect(glyph('Scene')).toBe('✓') // passed — sceneValid produced
    expect(glyph('Programming')).toBe('●') // current — active route
    expect(glyph('Evaluation')).toBe('✓') // passed — analyzed produced
    expect(glyph('Execution')).toBe('○') // pending — requirements met, not reached
    expect(glyph('Sessions')).toBe('○') // pending — guard relaxed, nothing blocks the browser
  })

  it('marks the active route stage as current (S4: I know where I am)', () => {
    seedFlags({ robotLoaded: true, compiled: true })
    renderStepper('/task')
    expect(screen.getByRole('button', { name: 'Programming' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Execution' })).not.toHaveAttribute('aria-current')
  })

  it('excludes non-stage areas from the stepper (knowledge; Configuration is not a stage)', () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true, completed: true, analyzed: true })
    renderStepper('/sessions')
    expect(screen.queryByRole('button', { name: 'Knowledge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configuration' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  it('stepperStages drops kind:tool entries even when a stage number is present (defensive filter)', () => {
    // No tool entries exist in the registry today (P0-B removed /analysis —
    // Workspace Analysis is a Robot accordion tool), so the stage filter alone
    // hides them. The kind filter is the REAL guard: a future tool that
    // carries a stage number must still never render in the pipeline.
    const toolWithStage: WorkspaceEntry = {
      path: '/tools/ws',
      workspace: 'ws-tool' as WorkspaceName,
      label: 'Workspace Analysis',
      requires: ['robotLoaded'],
      produces: null,
      capability: null,
      hidden: false,
      consumes: null,
      producesArtifact: null,
      stage: 7,
      kind: 'tool',
    }
    const stages = stepperStages([...WORKSPACE_REGISTRY, toolWithStage])
    expect(stages.some((e) => e.workspace === ('ws-tool' as WorkspaceName))).toBe(false)
  })

  it('shows future stages whose requirements are met as pending (next step visible)', () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true, analyzed: true })
    renderStepper('/task')
    const execution = screen.getByRole('button', { name: 'Execution' })
    expect(execution).not.toBeDisabled()
    expect(execution).not.toHaveAttribute('aria-current')
  })

  it('derives a blocked reason from the missing flag (not a fixed string)', () => {
    seedFlags({ robotLoaded: true, compiled: true }) // executable=false
    renderStepper('/task')
    expect(screen.getByText('Requires a runnable or finished execution')).toBeInTheDocument()
    // Sessions is no longer blocked (guard relaxed) — no completed reason exists.
    expect(screen.queryByText(/Requires a completed execution/)).not.toBeInTheDocument()
  })
})

describe('Stepper — click = navigation, availability is separate (C3, threat "stepper click when blocked")', () => {
  it('navigates when a stage is clickable (requirements met)', async () => {
    seedFlags({ robotLoaded: true, compiled: true, executable: true })
    const router = renderStepper('/task')
    fireEvent.click(screen.getByRole('button', { name: 'Execution' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))
  })

  it('does not navigate on a blocked stage and shows the derived reason', async () => {
    seedFlags({ robotLoaded: true, compiled: true }) // executable=false
    const router = renderStepper('/task')
    const execution = screen.getByRole('button', { name: 'Execution' })
    expect(execution).toBeDisabled()
    expect(screen.getByText('Requires a runnable or finished execution')).toBeInTheDocument()
    fireEvent.click(execution)
    expect(router.state.location.pathname).toBe('/task')
  })

  it('does not navigate on a blocked Scene stage (robot not loaded) and shows the reason', async () => {
    seedFlags({ robotLoaded: false })
    const router = renderStepper('/task')
    const scene = screen.getByRole('button', { name: 'Scene' })
    expect(scene).toBeDisabled()
    expect(screen.getByText('Requires a loaded robot')).toBeInTheDocument()
    fireEvent.click(scene)
    expect(router.state.location.pathname).toBe('/task')
  })

  it('Robot is always navigable (no prerequisites — stage-1 entry point)', async () => {
    seedFlags({ robotLoaded: true, compiled: true })
    const router = renderStepper('/task')
    const robot = screen.getByRole('button', { name: 'Robot' })
    expect(robot).not.toBeDisabled()
    fireEvent.click(robot)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
