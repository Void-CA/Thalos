// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RobotSelector, ROBOT_SELECTION_KEY } from './robot-selector'
import { RobotCatalog } from '@/features/robots/components/robot-catalog'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '@/features/viewport/store'
import { useSceneRobotSync } from '@/features/viewport/synchronization/use-scene-robot-sync'
import type { RuntimeInfo, SceneData } from '@/features/viewport/types'

const CATALOG_FIXTURE = vi.hoisted(() => [
  { id: 'scara', display_name: 'SCARA', dof: 4, joints: [] },
  { id: 'planar_3r', display_name: 'Planar 3R', dof: 3, joints: [] },
])

const mocks = vi.hoisted(() => ({
  loadRobotMutate: vi.fn(),
  loadSceneMutate: vi.fn(),
  urdfMutate: vi.fn(),
}))

vi.mock('@/features/robots/api/robot-api', () => ({
  robotApi: {
    list: () => Promise.resolve(CATALOG_FIXTURE),
    get: (id: string) => Promise.resolve(CATALOG_FIXTURE.find((r) => r.id === id)),
  },
}))

vi.mock('@/features/viewport/synchronization/use-scene-loader', () => ({
  useLoadRobot: () => ({ mutate: mocks.loadRobotMutate }),
  useLoadScene: () => ({ mutate: mocks.loadSceneMutate }),
  useLoadRobotFromUrdf: () => ({
    mutate: mocks.urdfMutate,
    isPending: false,
    isSuccess: false,
    error: null,
  }),
}))

function runtime(robotId: string, displayName = 'test'): RuntimeInfo {
  return {
    robot: { id: robotId, display_name: displayName, dof: 2, joints: [] },
    joints: [],
    generatedAt: '2026-08-04T00:00:00Z',
  }
}

function renderSelector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RobotSelector />
    </QueryClientProvider>,
  )
}

const taskRobotSelect = () =>
  screen.getByRole('combobox', { name: 'Task robot' }) as HTMLSelectElement

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useRobotStore.getState().setRobots(CATALOG_FIXTURE)
  useRobotStore.getState().select(null)
  useSceneStore.getState().reset()
})

afterEach(() => cleanup())

describe('RobotSelector — reads the CONFIRMED identity from the scene runtime (spec R5.1)', () => {
  it('displays a URDF robot as selected when the scene runtime confirms it', async () => {
    // Scene (applyScene response) holds a URDF identity — not part of the catalog.
    useSceneStore.setState({ runtime: runtime('urdf:a3f8b2c1d4e5', 'My URDF Robot') })

    renderSelector()

    await waitFor(() => {
      expect(taskRobotSelect()).toHaveValue('urdf:a3f8b2c1d4e5')
    })
    expect(screen.getByRole('option', { name: 'My URDF Robot' })).toBeInTheDocument()
  })

  it('displays a catalog robot as selected when the scene runtime confirms it', async () => {
    useSceneStore.setState({ runtime: runtime('scara', 'SCARA') })

    renderSelector()

    await waitFor(() => {
      expect(taskRobotSelect()).toHaveValue('scara')
    })
  })
})

describe('RobotSelector — localStorage is a REQUEST hint, not authority (spec R6)', () => {
  it('mounts with a persisted catalog id and requests it via select()', async () => {
    localStorage.setItem(ROBOT_SELECTION_KEY, 'scara')

    renderSelector()

    await waitFor(() => {
      expect(useRobotStore.getState().selectedId).toBe('scara')
    })
  })

  it('ignores an unknown persisted id — no select() call, backend default wins', async () => {
    localStorage.setItem(ROBOT_SELECTION_KEY, 'unknown-robot')

    renderSelector()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(useRobotStore.getState().selectedId).toBeNull()
  })

  it('persists ONLY catalog ids on user change — urdf identities are never persisted', async () => {
    useSceneStore.setState({ runtime: runtime('urdf:a3f8b2c1d4e5', 'My URDF Robot') })
    renderSelector()
    await waitFor(() => expect(taskRobotSelect()).toHaveValue('urdf:a3f8b2c1d4e5'))

    // User switches to a catalog robot → hint persisted + request sent.
    fireEvent.change(taskRobotSelect(), { target: { value: 'scara' } })

    expect(localStorage.getItem(ROBOT_SELECTION_KEY)).toBe('scara')
    expect(useRobotStore.getState().selectedId).toBe('scara')
  })

  it('migrates a stale persisted urdf:* hint — ignored, no select() request, backend default wins', async () => {
    // Pre-PR-2 code persisted whatever id was selected, including URDF ids.
    // After the identity contract (R1: urdf:* is scene state, not catalog),
    // a leftover urdf:* hint MUST be treated like any unknown id: ignored,
    // never requested through select(), never re-persisted.
    localStorage.setItem(ROBOT_SELECTION_KEY, 'urdf:a3f8b2c1d4e5')

    renderSelector()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(useRobotStore.getState().selectedId).toBeNull()
    expect(localStorage.getItem(ROBOT_SELECTION_KEY)).toBe('urdf:a3f8b2c1d4e5')
  })

  it('never persists or requests a confirmed URDF identity when it is the displayed value', async () => {
    // The URDF option is DISPLAY-ONLY (R5.1). Re-picking the already-confirmed
    // identity from the <select> must not write it back to localStorage nor
    // send it through the catalog request path.
    useSceneStore.setState({ runtime: runtime('urdf:a3f8b2c1d4e5', 'My URDF Robot') })
    renderSelector()
    await waitFor(() => expect(taskRobotSelect()).toHaveValue('urdf:a3f8b2c1d4e5'))

    fireEvent.change(taskRobotSelect(), { target: { value: 'urdf:a3f8b2c1d4e5' } })

    expect(localStorage.getItem(ROBOT_SELECTION_KEY)).toBeNull()
    expect(useRobotStore.getState().selectedId).toBeNull()
  })
})

describe('Integration — catalog select flows through the request path (spec R5.2)', () => {
  function Harness() {
    useSceneRobotSync()
    return (
      <div>
        <RobotCatalog />
        <RobotSelector />
      </div>
    )
  }

  function renderHarness() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    )
  }

  it('selector shows the CONFIRMED identity, not the pending request, when the backend confirms a different robot', async () => {
    // Backend decides independently: request for 'scara' is answered with the
    // scene default identity (like the R6 unknown-id case). The displayed
    // selection must NOT change until applyScene confirms (R5.2).
    mocks.loadRobotMutate.mockImplementation(() => {
      useSceneStore
        .getState()
        .applyScene({} as SceneData, runtime('planar_3r', 'Planar 3R'), null, null, null, null)
    })

    renderHarness()

    const scaraCard = await screen.findByRole('button', { name: /SCARA/ })
    fireEvent.click(scaraCard)

    // Request path: catalog select → useSceneRobotSync → useLoadRobot → applyScene.
    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('planar_3r')
    })
    expect(mocks.loadRobotMutate).toHaveBeenCalledWith('scara')

    // The selector is a READER: it displays the confirmed scene identity.
    await waitFor(() => {
      expect(taskRobotSelect()).toHaveValue('planar_3r')
    })
  })

  it('full happy path: catalog select → applyScene confirms the requested robot → selector updates', async () => {
    mocks.loadRobotMutate.mockImplementation((id: string) => {
      useSceneStore
        .getState()
        .applyScene({} as SceneData, runtime(id), null, null, null, null)
    })

    renderHarness()

    const scaraCard = await screen.findByRole('button', { name: /SCARA/ })
    fireEvent.click(scaraCard)

    await waitFor(() => {
      expect(useSceneStore.getState().runtime?.robot.id).toBe('scara')
    })
    await waitFor(() => {
      expect(taskRobotSelect()).toHaveValue('scara')
    })
  })
})
