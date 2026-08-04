// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { SessionsWorkspace } from './workspace'

/**
 * S5.5 — SessionsWorkspace wiring test: the area now renders the full
 * SessionBrowser (list + filters + search + detail preview) instead of the
 * minimal list. Behavior lives in components/session-browser.test.tsx —
 * this file only pins that the workspace mounts the browser (heading +
 * endpoint-derived empty state) against the canonical api module.
 */

const apiMocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@/features/sessions/api/session-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sessions/api/session-api')>()
  return { ...actual, sessionApi: apiMocks }
})

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionsWorkspace />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMocks.list.mockReset()
})
afterEach(() => cleanup())

describe('SessionsWorkspace — renders the session browser (S5.5)', () => {
  it('mounts the browser shell (Sesiones heading) and delegates to GET /sessions', async () => {
    apiMocks.list.mockResolvedValue([])
    renderWorkspace()

    expect(screen.getByRole('heading', { name: 'Sesiones' })).toBeInTheDocument()
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
    expect(apiMocks.list).toHaveBeenCalledTimes(1)
  })

  it('shows one row per session from the canonical list endpoint', async () => {
    apiMocks.list.mockResolvedValue([
      {
        id: 1,
        plan_id: 'plan-a',
        source: 'live',
        status: 'Completed',
        started_at: '2026-08-01T10:00:00Z',
        paused_at: null,
        completed_at: null,
        duration: 12.5,
        joint_count: 4,
        robot_name: 'SCARA',
      },
    ])
    renderWorkspace()

    await screen.findAllByRole('listitem')
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('plan-a')).toBeInTheDocument()
  })
})
