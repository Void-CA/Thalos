// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { DemosWorkspace } from './workspace'
import { useSemanticEditor } from '@/features/semantic/store'
import {
  useDomainSceneStore, SEEDED_OBJECTS, SEEDED_LOCATIONS, DEFAULT_APPROACH_HEIGHT,
} from '@/features/scene/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import type { SceneFile, DemoCatalogEntry, TaskDocument } from '@/shared/contracts'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * Demos workspace tests (demos-workspace spec + D13):
 *
 * - Registry contract (kind:'tool', not a stepper stage) lives in
 *   registry.test.ts — here we test BEHAVIOR at the /demos workspace.
 * - Load Demo hydrates scene + program stores WITHOUT executing (load ≠ run):
 *   the critical assertion is `executeSemantic` is NEVER called by a load.
 * - Run triggers the existing pipeline (execute → read-back → navigate) —
 *   the same path the Task editor uses (task 4.3 E2E happy path).
 * - Error states: catalog fetch failure, demo 404, invalid scene JSON — the
 *   message is shown and the stores stay unchanged.
 */

const demosApiMocks = vi.hoisted(() => ({
  listDemos: vi.fn(),
  getDemoScene: vi.fn(),
  getDemoProgram: vi.fn(),
}))

vi.mock('./api', () => demosApiMocks)

const apiMocks = vi.hoisted(() => ({
  executeSemantic: vi.fn(),
  compileSemantic: vi.fn(),
}))

vi.mock('@/features/semantic/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/semantic/api')>()
  return { ...actual, executeSemantic: apiMocks.executeSemantic, compileSemantic: apiMocks.compileSemantic }
})

const previewMocks = vi.hoisted(() => ({
  getScene: vi.fn(),
  analyze: vi.fn(),
}))

vi.mock('@/features/viewport/api/scene-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewport/api/scene-api')>()
  return { ...actual, sceneApi: { ...actual.sceneApi, getScene: previewMocks.getScene } }
})

vi.mock('@/features/analysis/api/plan-analysis-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/analysis/api/plan-analysis-api')>()
  return { ...actual, planAnalysisApi: { ...actual.planAnalysisApi, analyze: previewMocks.analyze } }
})

const demoScene: SceneFile = {
  schema_version: '1',
  robot: { name: 'icebot', urdf: 'docs/execution/robot/icebot.urdf' },
  objects: [
    { id: 'box-1', kind: 'box', name: 'Box', pose: { position: [0.2, 0.1, 0], orientation: [1, 0, 0, 0] } },
  ],
  fixtures: [],
  locations: [
    { id: 'tray-1', kind: 'placement_target', pose: { position: [0.2, -0.1, 0], orientation: [1, 0, 0, 0] } },
  ],
  home_pose: { position: [0.2, 0, 0.1], orientation: [1, 0, 0, 0] },
  approach_height: 0.05,
}

const demoProgram = 'pick box-1\nplace box-1 at tray-1\nhome'

const catalog: DemoCatalogEntry[] = [
  { id: 'happy-path', title: 'Happy Path', category: 'pick-place', narrative: 'Pick a box onto a tray' },
  { id: 'multi-object', title: 'Multi Object', category: 'pick-place' },
]

const executeResponse = {
  status: 'ok',
  segment_count: 3,
  duration_secs: 8.5,
  waypoints: [],
  event_count: 2,
}

const sceneWithPlan: RuntimeStateResponse = {
  generated_at: '2026-01-01T00:00:00Z',
  robot: { id: 'r1', display_name: 'R1', dof: 2, joints: [] },
  joints: [0, 0],
  scene: { frames: [], links: [], joint_axes: [], twists: [], primitives: [] },
  ik_result: null,
  active_plan: null,
  active_tcp: null,
  execution: { status: 'Ready', progress: 0, elapsed_secs: 0 },
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

function resetStores() {
  useDomainSceneStore.setState({
    objects: SEEDED_OBJECTS.map((o) => ({ ...o })),
    locations: SEEDED_LOCATIONS.map((l) => ({ ...l })),
    tools: [],
    homePose: { position: [1.8, 0.0, 0.5], orientation: [0, 0, 0, 1] },
    approachHeight: DEFAULT_APPROACH_HEIGHT,
    robot: null,
  })
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle', activePlan: null })
  useAnalysisStore.setState({ report: null })
  useSceneStore.getState().reset()
}

function renderWorkspace() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div>landing</div> },
      { path: '/demos', element: <DemosWorkspace /> },
      { path: '/execution', element: <div>execution-view</div> },
    ],
    { initialEntries: ['/demos'] },
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, ...utils }
}

beforeEach(() => {
  demosApiMocks.listDemos.mockReset()
  demosApiMocks.getDemoScene.mockReset()
  demosApiMocks.getDemoProgram.mockReset()
  apiMocks.executeSemantic.mockReset()
  previewMocks.getScene.mockReset()
  previewMocks.analyze.mockReset()
  demosApiMocks.listDemos.mockResolvedValue(catalog)
  demosApiMocks.getDemoScene.mockResolvedValue(demoScene)
  demosApiMocks.getDemoProgram.mockResolvedValue(demoProgram)
  resetStores()
})
afterEach(() => cleanup())

describe('DemosWorkspace — catalog list', () => {
  it('lists the catalog entries with title, category and narrative', async () => {
    renderWorkspace()

    expect(await screen.findByRole('heading', { name: 'Happy Path' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Multi Object' })).toBeInTheDocument()
    // Both catalog entries share the pick-place category — both cards render it.
    expect(screen.getAllByText('pick-place')).toHaveLength(2)
    expect(screen.getByText('Pick a box onto a tray')).toBeInTheDocument()
    expect(demosApiMocks.listDemos).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when the catalog is empty (spec: empty → [])', async () => {
    demosApiMocks.listDemos.mockResolvedValue([])
    renderWorkspace()

    expect(await screen.findByText(/No demos/i)).toBeInTheDocument()
  })

  it('surfaces a catalog fetch failure as an alert', async () => {
    demosApiMocks.listDemos.mockRejectedValue(new Error('Backend is offline'))
    renderWorkspace()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Backend is offline/)
  })
})

describe('DemosWorkspace — [Load Demo] hydrates WITHOUT executing (D13, load ≠ run)', () => {
  it('loads scene + program into their stores and NEVER calls executeSemantic', async () => {
    renderWorkspace()
    const loadButton = await screen.findByRole('button', { name: 'Load demo Happy Path' })

    fireEvent.click(loadButton)

    // Scene store hydrated from the demo SceneFile (full replacement).
    await waitFor(() =>
      expect(useDomainSceneStore.getState().objects).toEqual([
        expect.objectContaining({ id: 'box-1', name: 'Box', kind: 'box' }),
      ]),
    )
    expect(useDomainSceneStore.getState().locations).toEqual([
      expect.objectContaining({ id: 'tray-1' }),
    ])
    expect(useDomainSceneStore.getState().homePose.position).toEqual([0.2, 0, 0.1])
    expect(useDomainSceneStore.getState().robot).toEqual({ name: 'icebot', urdf: 'docs/execution/robot/icebot.urdf' })
    // Program store replaced from the demo program text.
    expect(useSemanticEditor.getState().operations.map((o) => o.type)).toEqual(['pick', 'place', 'home'])
    // THE load ≠ run invariant: hydration must never trigger the pipeline.
    expect(apiMocks.executeSemantic).not.toHaveBeenCalled()
    expect(useExecutionStore.getState().activePlan).toBeNull()
  })

  it('loads BOTH payloads for the selected demo (scene and program are independent actions)', async () => {
    renderWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'Load demo Multi Object' }))

    await waitFor(() => expect(demosApiMocks.getDemoScene).toHaveBeenCalledWith('multi-object'))
    expect(demosApiMocks.getDemoProgram).toHaveBeenCalledWith('multi-object')
  })

  it('shows an error and leaves the stores unchanged when the demo 404s', async () => {
    demosApiMocks.getDemoScene.mockRejectedValue(new Error("demo not found: 'nope'"))
    renderWorkspace()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const sceneBefore = JSON.stringify(useDomainSceneStore.getState().objects)

    fireEvent.click(await screen.findByRole('button', { name: 'Load demo Happy Path' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/demo not found: 'nope'/)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(JSON.stringify(useDomainSceneStore.getState().objects)).toBe(sceneBefore)
    expect(apiMocks.executeSemantic).not.toHaveBeenCalled()
  })

  it('shows an error and leaves the stores unchanged on invalid scene JSON', async () => {
    demosApiMocks.getDemoScene.mockResolvedValue({ schema_version: '1' } as unknown as SceneFile)
    renderWorkspace()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)
    const sceneBefore = JSON.stringify(useDomainSceneStore.getState().objects)

    fireEvent.click(await screen.findByRole('button', { name: 'Load demo Happy Path' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid scene/i)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
    expect(JSON.stringify(useDomainSceneStore.getState().objects)).toBe(sceneBefore)
  })

  it('surfaces a program parse failure without mutating the program (R2 atomicity)', async () => {
    demosApiMocks.getDemoProgram.mockResolvedValue('pick box-1\njump 10')
    renderWorkspace()
    const opsBefore = JSON.stringify(useSemanticEditor.getState().operations)

    fireEvent.click(await screen.findByRole('button', { name: 'Load demo Happy Path' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unknown command 'jump'/)
    expect(JSON.stringify(useSemanticEditor.getState().operations)).toBe(opsBefore)
  })
})

describe('DemosWorkspace — [Run] triggers the existing pipeline (task 4.3 E2E happy path)', () => {
  it('loads a demo then runs: execute → read-back → navigate to /execution', async () => {
    apiMocks.executeSemantic.mockResolvedValue(executeResponse)
    previewMocks.getScene.mockResolvedValue(sceneWithPlan)
    previewMocks.analyze.mockResolvedValue(analysisReport)
    const { router } = renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: 'Load demo Happy Path' }))
    await waitFor(() =>
      expect(useSemanticEditor.getState().operations.map((o) => o.type)).toEqual(['pick', 'place', 'home']),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(apiMocks.executeSemantic).toHaveBeenCalledTimes(1))
    const call = apiMocks.executeSemantic.mock.calls[0][0] as { task: TaskDocument }
    expect(call.task.program.operations.map((o) => o.type)).toEqual(['pick', 'place', 'home'])
    expect(call.task.scene.objects).toEqual([
      expect.objectContaining({ id: 'box-1', category: 'box' }),
    ])
    // Read-back + analysis fired (spec "Run executes via existing pipeline").
    await waitFor(() => expect(previewMocks.getScene).toHaveBeenCalled())
    expect(previewMocks.analyze).toHaveBeenCalled()
    // Plan handed to Execution + navigation upon success.
    expect(useExecutionStore.getState().activePlan).toEqual({
      instructionCount: 3,
      durationSecs: 8.5,
      source: 'TaskDocument',
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/execution'))
  })

  it('surfaces an execute failure without navigating', async () => {
    apiMocks.executeSemantic.mockResolvedValue({ ...executeResponse, status: 'error' })
    const { router } = renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: 'Load demo Happy Path' }))
    await waitFor(() =>
      expect(useSemanticEditor.getState().operations.map((o) => o.type)).toEqual(['pick', 'place', 'home']),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(screen.getByText(/Run failed/i)).toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/demos')
    expect(useExecutionStore.getState().status).toBe('idle')
  })

  it('keeps Run disabled until a program is loaded (no operations → nothing to run)', async () => {
    // A fresh semantic store seeds the sample program — clear it to model a
    // workspace with nothing loaded yet.
    useSemanticEditor.setState({ operations: [] })
    renderWorkspace()
    await screen.findByRole('button', { name: 'Load demo Happy Path' })
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })
})
