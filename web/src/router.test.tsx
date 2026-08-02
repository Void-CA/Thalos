// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { routerConfig, VIEW_REGISTRY } from '@/router'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { ServicesProvider } from '@/features/viewport/services/service-context'

/**
 * Integration tests for the navigation-router spec (slice 1).
 * The real Viewport renders a three.js <Canvas> (no WebGL under jsdom), so it
 * is replaced by a stub that counts mount/unmount — the persistence assertion
 * is: navigating must never unmount the viewport (invariant #1).
 */
const viewportMetrics = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))

vi.mock('@/features/viewport/viewport', async () => {
  const React = await import('react')
  return {
    Viewport: () => {
      React.useEffect(() => {
        viewportMetrics.mounts += 1
        return () => {
          viewportMetrics.unmounts += 1
        }
      }, [])
      return React.createElement('div', { 'data-testid': 'viewport-stub' })
    },
  }
})

function renderRouter(initialEntries: string[]) {
  const router = createMemoryRouter(routerConfig, { initialEntries })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <RouterProvider router={router} />
      </ServicesProvider>
    </QueryClientProvider>,
  )
  return { router, ...utils }
}

beforeEach(() => {
  viewportMetrics.mounts = 0
  viewportMetrics.unmounts = 0
})
afterEach(() => cleanup())

describe('layout route: persistent viewport (invariant #1)', () => {
  it('keeps the viewport mounted when navigating /task → /planning', async () => {
    const { router } = renderRouter(['/task'])

    // Full shell resolves at /task; viewport mounted exactly once.
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(1)
    expect(screen.getByRole('link', { name: 'Task' })).toHaveAttribute('aria-current', 'page')

    // URL-driven navigation via the TopBar nav link.
    fireEvent.click(screen.getByRole('link', { name: 'Planning' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/planning'))

    // Only the Outlet content changed; the viewport was never unmounted/remounted.
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Planning' })).toHaveAttribute('aria-current', 'page')
    expect(viewportMetrics.mounts).toBe(1)
    expect(viewportMetrics.unmounts).toBe(0)
  })

  it('supports browser back/forward while the viewport persists', async () => {
    const { router } = renderRouter(['/', '/task', '/planning'])

    expect(router.state.location.pathname).toBe('/planning')

    act(() => {
      router.navigate(-1)
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/task'))
    expect(screen.getByRole('link', { name: 'Task' })).toHaveAttribute('aria-current', 'page')
    expect(viewportMetrics.unmounts).toBe(0)

    act(() => {
      router.navigate(1)
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/planning'))
    expect(screen.getByRole('heading', { name: 'Motion Program' })).toBeInTheDocument()
    expect(viewportMetrics.mounts).toBe(1)
    expect(viewportMetrics.unmounts).toBe(0)
  })
})

describe('direct URL entry renders the full shell', () => {
  it('renders TopBar + Viewport + StatusBar + workspace panel at /execution', () => {
    renderRouter(['/execution'])
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeInTheDocument()
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(screen.getByText('Thalos Robotics')).toBeInTheDocument() // StatusBar
    expect(screen.getByRole('link', { name: 'Task' })).toBeInTheDocument() // TopBar nav
  })
})

describe('hidden routes render placeholders (no 404)', () => {
  it.each([
    ['/sessions', 'Sessions'],
    ['/knowledge', 'Knowledge'],
  ])('renders a placeholder at %s (no 404)', (path, heading) => {
    renderRouter([path])
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
    expect(screen.getByText('Thalos Robotics')).toBeInTheDocument()
  })

  it('does not show nav links for hidden workspaces', () => {
    renderRouter(['/'])
    expect(screen.getByRole('link', { name: 'Task' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Execution' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Knowledge' })).not.toBeInTheDocument()
  })
})

describe('router covers every registered workspace', () => {
  it('maps every registry workspace to a view in VIEW_REGISTRY', () => {
    for (const entry of WORKSPACE_REGISTRY) {
      expect(VIEW_REGISTRY[entry.workspace]).toBeDefined()
    }
  })

  it.each(WORKSPACE_REGISTRY.filter((e) => !e.hidden))(
    'renders $path ($workspace) with the full shell and an active nav link',
    (entry) => {
      renderRouter([entry.path])
      expect(screen.getByTestId('viewport-stub')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: entry.label })).toHaveAttribute('aria-current', 'page')
    },
  )
})
