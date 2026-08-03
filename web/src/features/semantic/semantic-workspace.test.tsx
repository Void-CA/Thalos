// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { SemanticWorkspace } from './semantic-workspace'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'

/**
 * Task workspace structure (frontend-task-workspace spec, task 4.3, C2 +
 * S2 area-scene): the workspace is a pure authoring environment —
 * Program (operations editor) and Diagnostics (compile status). The Scene
 * panel is GONE (moved to the Escena area, features/scene/SceneWorkspace);
 * Task consumes the Scene artifact (sceneValid) but renders zero Scene
 * editing UI (area-scene spec, "Task has no Scene panel").
 */
function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SemanticWorkspace />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('Task workspace — Program / Diagnostics only (S2: no Scene panel)', () => {
  it('shows zero Scene editing UI in Task (SceneEditor lives in /scene)', () => {
    renderWorkspace()
    expect(screen.queryByText('Objects')).not.toBeInTheDocument()
    expect(screen.queryByText('Locations')).not.toBeInTheDocument()
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
    expect(screen.queryByText(/objects · locations · tools · home/i)).not.toBeInTheDocument()
  })

  it('renders the Program panel (operations editor) as a heading', () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Program' })).toBeInTheDocument()
  })

  it('renders the Diagnostics panel with a "no compile result" state', () => {
    renderWorkspace()
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument()
    expect(screen.getByText(/No compile result/)).toBeInTheDocument()
  })

  it('Escena is a first-class registry entry (path /scene, produces sceneValid)', () => {
    const scene = WORKSPACE_REGISTRY.find((e) => e.workspace === 'scene')
    expect(scene).toBeDefined()
    expect(scene?.path).toBe('/scene')
    expect(scene?.requires).toEqual(['robotLoaded'])
    expect(scene?.produces).toBe('sceneValid')
    expect(scene?.hidden).toBe(false)
  })
})
