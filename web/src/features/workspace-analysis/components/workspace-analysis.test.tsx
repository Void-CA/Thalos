// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { WorkspaceAnalysis } from './workspace-analysis'
import { WORKSPACE_PRESETS } from './presets'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '@/features/viewport/store'
import { useWorkspaceStore } from '../workspace-analysis-store'

const mocks = vi.hoisted(() => ({
  sample: vi.fn(),
  analyzeSingularity: vi.fn(),
  analyzeManipulability: vi.fn(),
}))

vi.mock('@/features/viewport/services/service-context', () => ({
  useWorkspaceService: () => ({
    sample: mocks.sample,
    analyzeSingularity: mocks.analyzeSingularity,
    analyzeManipulability: mocks.analyzeManipulability,
  }),
}))

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <WorkspaceAnalysis />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useRobotStore.getState().setRobots([])
  useRobotStore.getState().select(null)
  useSceneStore.getState().reset()
  useWorkspaceStore.getState().reset()
})

afterEach(() => cleanup())

describe('WorkspaceAnalysis — explicit trigger, no auto-run (spec: Explicit Run Trigger)', () => {
  it('mounts with a loaded robot and makes ZERO sampling calls (no auto-run on mount)', () => {
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()

    expect(mocks.sample).not.toHaveBeenCalled()
    expect(mocks.analyzeSingularity).not.toHaveBeenCalled()
    expect(mocks.analyzeManipulability).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeEnabled()
  })

  it('disables Run Analysis when no robot is loaded (Robot-Loaded Guard)', () => {
    renderWorkspace()

    expect(screen.getByRole('button', { name: /run analysis/i })).toBeDisabled()
    expect(mocks.sample).not.toHaveBeenCalled()
    expect(mocks.analyzeSingularity).not.toHaveBeenCalled()
    expect(mocks.analyzeManipulability).not.toHaveBeenCalled()
  })

  it('enables Run Analysis when the scene runtime holds a URDF robot (guard is scene-aware)', () => {
    useSceneStore.setState({
      runtime: {
        robot: { id: 'urdf:a3f8b2c1d4e5', display_name: 'My URDF Robot', dof: 2, joints: [] },
        joints: [],
        generatedAt: '2026-08-04T00:00:00Z',
      },
    })

    renderWorkspace()

    expect(screen.getByRole('button', { name: /run analysis/i })).toBeEnabled()
    expect(mocks.analyzeSingularity).not.toHaveBeenCalled()
  })
})

describe('WorkspaceAnalysis — explicit trigger runs 3 mutations (spec: Explicit trigger runs sampling)', () => {
  it('passes null as robot id to all three analysis services even when a catalog robot is selected', async () => {
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
    await waitFor(() => {
      expect(mocks.analyzeSingularity).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
    await waitFor(() => {
      expect(mocks.analyzeManipulability).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
  })

  it('targets /active with null robot id when the SCENE holds a URDF robot (R3 chain targeting)', async () => {
    useSceneStore.setState({
      runtime: {
        robot: { id: 'urdf:a3f8b2c1d4e5', display_name: 'My URDF Robot', dof: 2, joints: [] },
        joints: [],
        generatedAt: '2026-08-04T00:00:00Z',
      },
    })

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
    await waitFor(() => {
      expect(mocks.analyzeSingularity).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
    await waitFor(() => {
      expect(mocks.analyzeManipulability).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
  })

  it('renders the TABBED inline report — one metric panel per feature', async () => {
    mocks.sample.mockResolvedValue({
      metrics: { bounding_volume: 1.25, max_reach: 0.8, min_reach: 0.2, sample_count: 10000 },
      bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0.5] },
      samples: [{ position: [0.1, 0.2, 0.3] }],
    })
    mocks.analyzeSingularity.mockResolvedValue({
      metrics: {
        normal_count: 9900, near_singular_count: 95, singular_count: 5, total_samples: 10000,
        avg_condition_number: 12.5, min_condition_number: 1.02,
      },
      samples: [{ position: [0.1, 0.2, 0.3], state: 'normal' }],
    })
    mocks.analyzeManipulability.mockResolvedValue({
      metrics: {
        avg_yoshikawa: 0.42, min_yoshikawa: 0.1, max_yoshikawa: 0.9,
        avg_isotropy: 0.55, min_isotropy: 0.12, max_isotropy: 0.85, total_samples: 10000,
      },
      samples: [{ position: [0.1, 0.2, 0.3], yoshikawa: 0.42 }],
    })
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    // Default tab = first feature with data → Workspace (all three succeed).
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Singularity' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Manipulability' })).toBeInTheDocument()

    // Workspace tab: MetricRow/MetricRange metrics from the resolved data.
    expect(screen.getByText('Bounding Volume')).toBeInTheDocument()
    expect(screen.getByText('Reach')).toBeInTheDocument()
    expect(screen.getByText('1.2500')).toBeInTheDocument()
    expect(screen.getByText('0.8')).toBeInTheDocument()

    // Singularity tab — its own metrics live on its panel.
    fireEvent.click(screen.getByRole('tab', { name: 'Singularity' }))
    expect(screen.getByRole('heading', { name: 'Singularity' })).toBeInTheDocument()
    expect(screen.getByText('Avg Condition Number')).toBeInTheDocument()

    // Manipulability tab — metrics + the pct fix renders 12% — 85% (values
    // are ratios scaled ×100; the text is split across child spans, so assert
    // on the row's full textContent).
    fireEvent.click(screen.getByRole('tab', { name: 'Manipulability' }))
    expect(screen.getByRole('heading', { name: 'Manipulability' })).toBeInTheDocument()
    expect(screen.getByText('Isotropy')).toBeInTheDocument()
    expect(screen.getByText('Isotropy').parentElement).toHaveTextContent('12—85%')

    // No modal overlay — inline tabs (spec: Non-Blocking Inline Section).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('switching tabs drives the 3D point-cloud color mode one-way (tab → color)', async () => {
    mocks.sample.mockResolvedValue({
      metrics: { bounding_volume: 1.25, max_reach: 0.8, min_reach: 0.2, sample_count: 10000 },
      bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0.5] },
      samples: [{ position: [0.1, 0.2, 0.3] }],
    })
    mocks.analyzeSingularity.mockResolvedValue({
      metrics: {
        normal_count: 9900, near_singular_count: 95, singular_count: 5, total_samples: 10000,
        avg_condition_number: 12.5, min_condition_number: 1.02,
      },
      samples: [{ position: [0.1, 0.2, 0.3], state: 'normal' }],
    })
    mocks.analyzeManipulability.mockResolvedValue({
      metrics: {
        avg_yoshikawa: 0.42, min_yoshikawa: 0.1, max_yoshikawa: 0.9,
        avg_isotropy: 0.55, min_isotropy: 0.12, max_isotropy: 0.85, total_samples: 10000,
      },
      samples: [{ position: [0.1, 0.2, 0.3], yoshikawa: 0.42 }],
    })
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    // Let the first data land (default tab = Workspace) before switching.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Singularity' }))
    expect(useWorkspaceStore.getState().colorMode).toBe('singularity')
    expect(useWorkspaceStore.getState().showPointCloud).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Manipulability' }))
    expect(useWorkspaceStore.getState().colorMode).toBe('manipulability')
    expect(useWorkspaceStore.getState().showPointCloud).toBe(true)

    // Manual color override (below the tabs) does NOT rewind the active tab.
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    expect(useWorkspaceStore.getState().colorMode).toBe('workspace')
    expect(screen.getByRole('heading', { name: 'Manipulability' })).toBeInTheDocument()
  })

  it('defaults to the first feature that has data; failed features show an empty state', async () => {
    mocks.sample.mockRejectedValue(new Error('workspace boom'))
    mocks.analyzeSingularity.mockResolvedValue({
      metrics: {
        normal_count: 9900, near_singular_count: 95, singular_count: 5, total_samples: 10000,
        avg_condition_number: 12.5, min_condition_number: 1.02,
      },
      samples: [{ position: [0.1, 0.2, 0.3], state: 'normal' }],
    })
    mocks.analyzeManipulability.mockRejectedValue(new Error('manip boom'))
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    // Workspace failed, singularity succeeded → Singularity is the default tab.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Singularity' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Workspace' })).not.toBeInTheDocument()

    // The failed feature shows its empty state in its tab rather than nothing.
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }))
    expect(screen.getByText('Workspace analysis failed')).toBeInTheDocument()
  })
})

describe('WorkspaceAnalysis — sampling presets (proposal P0-B)', () => {
  it('declares the Quick 1k / Balanced 10k / Precise 50k presets with the right sample counts', () => {
    expect(WORKSPACE_PRESETS.map(p => [p.label, p.samples])).toEqual([
      ['Quick 1k', 1000],
      ['Balanced 10k', 10000],
      ['Precise 50k', 50000],
    ])
  })

  it('selecting a preset drives the samples count sent to the services', async () => {
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Precise 50k' }))
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 50000, seed: 0, tolerance: 0.001 })
    })
  })

  it('advanced config overrides the preset once opened and edited', async () => {
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Precise 50k' }))

    // Open the disclosure, edit Samples → the custom value wins over the preset.
    fireEvent.click(screen.getByText('Advanced Config'))
    fireEvent.change(screen.getByLabelText('Samples'), { target: { value: '25000' } })

    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))
    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 25000, seed: 0, tolerance: 0.001 })
    })
  })

  it('opens the disclosure with the Balanced default without re-selecting', async () => {
    useRobotStore.getState().setRobots([{ id: 'scara', display_name: 'SCARA', dof: 4, joints: [] }])
    useRobotStore.getState().select('scara')

    renderWorkspace()
    // Balanced is the default — no preset click needed.
    fireEvent.click(screen.getByRole('button', { name: /run analysis/i }))

    await waitFor(() => {
      expect(mocks.sample).toHaveBeenCalledWith(null, { samples: 10000, seed: 0, tolerance: 0.001 })
    })
  })
})
