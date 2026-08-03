// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { SemanticWorkspace } from './semantic-workspace'

/**
 * Task workspace structure (frontend-task-workspace spec, task 4.3, C2):
 * the workspace is a pure authoring environment aligned with
 * TaskDocument { scene, program } — Scene (objects/locations/tools/home),
 * Program (operations editor) and Diagnostics (compile status) panels.
 *
 * NOTE (S2 transitional): the Scene panel still renders here while the Escena
 * area lands; the S2.3 follow-up removes it so Task consumes the Scene only
 * as an artifact. This file's assertions flip to "zero Scene UI" there.
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

describe('Task workspace — Scene / Program / Diagnostics panels (C2)', () => {
  it('renders the Scene panel with its resources (objects/locations)', () => {
    renderWorkspace()
    expect(screen.getByText('Objects')).toBeInTheDocument()
    expect(screen.getByText('Locations')).toBeInTheDocument()
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
})
