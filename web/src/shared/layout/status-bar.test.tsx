// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { StatusBar } from './status-bar'
import { useSceneStore } from '@/features/viewport/store'
import { useDomainSceneStore, type SceneObject } from '@/features/scene/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'
import type { CompileResponse } from '@/features/semantic/types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * Integration tests for S2: the status bar surfaces the REAL workflow state via
 * useWorkflowState + deriveStatusMessage — never a hardcoded string. Stores are
 * seeded per case and the rendered status line is asserted.
 *
 * The semantic stores are pre-seeded with a valid program + scene object, so
 * sceneValid/programValid are true by default after reset (operations present,
 * objects present, valid home pose). The flags are split (S1): sceneValid =
 * scene completeness, programValid = program completeness.
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

const seededObject: SceneObject = { id: 'bolt-1', name: 'Bolt', pose: { position: [1.8, 0, 0.4], orientation: [0, 0, 0, 1] } }

/** Seed the real stores; defaults mirror a freshly-reset editor. */
function seedStatus(opts: {
  robotLoaded?: boolean
  sceneValid?: boolean
  programValid?: boolean
  compiled?: boolean
  running?: boolean
  completed?: boolean
  executable?: boolean
  analyzed?: boolean
} = {}) {
  const {
    robotLoaded = false,
    sceneValid = true,
    programValid = true,
    compiled = false,
    running = false,
    completed = false,
    executable = false,
    analyzed = false,
  } = opts
  act(() => {
    useSceneStore.setState({ data: robotLoaded ? ({} as SceneData) : null })
    useDomainSceneStore.setState({ objects: sceneValid ? [seededObject] : [] })
    if (!programValid) useSemanticEditor.setState({ operations: [] })
    useSemanticEditor.setState({ result: compiled ? compileResult : null, dirty: 0 })
    useExecutionStore.setState({
      status: completed ? 'completed' : running ? 'running' : executable ? 'ready' : 'idle',
    })
    useAnalysisStore.setState({ report: analyzed ? analysisReport : null })
  })
}

beforeEach(() => {
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  // The domain scene store has no reset action — restore the canonical seed.
  useDomainSceneStore.setState({
    objects: [seededObject],
    homePose: { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] },
  })
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ report: null })
})
afterEach(() => cleanup())

describe('StatusBar — surfaces the real workflow state (S2)', () => {
  it('reports no robot loaded when the robot is missing', () => {
    seedStatus()
    render(<StatusBar />)
    expect(screen.getByText('No robot loaded')).toBeInTheDocument()
  })

  it('reports an incomplete scene (split flag)', () => {
    seedStatus({ robotLoaded: true, sceneValid: false })
    render(<StatusBar />)
    expect(screen.getByText('Scene incomplete')).toBeInTheDocument()
  })

  it('reports an incomplete task', () => {
    seedStatus({ robotLoaded: true, programValid: false })
    render(<StatusBar />)
    expect(screen.getByText('Task incomplete')).toBeInTheDocument()
  })

  it('reports recompilation required when the plan is stale (not "Ready")', () => {
    seedStatus({ robotLoaded: true })
    render(<StatusBar />)
    expect(screen.getByText('Task modified — recompilation required')).toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  })

  it('reports a running plan', () => {
    seedStatus({ robotLoaded: true, compiled: true, running: true })
    render(<StatusBar />)
    expect(screen.getByText('Plan running')).toBeInTheDocument()
  })

  it('reports a completed plan and points to sessions', () => {
    seedStatus({ robotLoaded: true, compiled: true, completed: true })
    render(<StatusBar />)
    expect(screen.getByText('Plan completed — review in Sessions')).toBeInTheDocument()
  })

  it('reports a plan ready to run', () => {
    seedStatus({ robotLoaded: true, compiled: true, executable: true })
    render(<StatusBar />)
    expect(screen.getByText('Plan ready to run')).toBeInTheDocument()
  })

  it('reports an analyzed plan before it is executable', () => {
    seedStatus({ robotLoaded: true, compiled: true, analyzed: true })
    render(<StatusBar />)
    expect(screen.getByText('Plan analyzed')).toBeInTheDocument()
  })

  it('defaults to the loaded + compiled baseline', () => {
    seedStatus({ robotLoaded: true, compiled: true })
    render(<StatusBar />)
    expect(screen.getByText('Robot loaded · Task compiled')).toBeInTheDocument()
  })

  it('keeps the product identity on the right side', () => {
    seedStatus()
    render(<StatusBar />)
    expect(screen.getByText('Thalos Robotics')).toBeInTheDocument()
  })
})
