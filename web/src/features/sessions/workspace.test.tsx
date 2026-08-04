// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { SessionsWorkspace } from './workspace'
import type { SessionSummary } from './api/session-api'

/**
 * S5.1 — behavior tests for the minimal sessions list (area-sessions spec:
 * "Sessions list renders", "Empty sessions list", "Sessions Area Minimal
 * Scope"). The workspace fetches `GET /sessions` via `sessionApi.list` and
 * renders ONLY metadata rows — no detail/trace/replay UI (deferred to the
 * future session-browser change).
 *
 * The api module is mocked so the contract under test is the workspace
 * projection (id + timestamp + status + robot + duration), not HTTP.
 */

const apiMocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('./api/session-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/session-api')>()
  return { ...actual, sessionApi: apiMocks }
})

const sessions: SessionSummary[] = [
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
  {
    id: 2,
    plan_id: 'plan-b',
    source: 'imported',
    status: 'Completed',
    started_at: '2026-08-01T11:30:00Z',
    paused_at: null,
    completed_at: null,
    duration: 8.25,
    joint_count: 6,
    robot_name: 'Delta',
  },
  {
    id: 3,
    plan_id: 'plan-a',
    source: 'live',
    status: 'Failed',
    started_at: '2026-08-01T12:00:00Z',
    paused_at: null,
    completed_at: null,
    duration: 3.0,
    joint_count: 4,
    robot_name: 'SCARA',
  },
]

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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

describe('Sessions list (area-sessions spec — minimal list view)', () => {
  it('renders one metadata row per session from GET /sessions (id + timestamp + status)', async () => {
    apiMocks.list.mockResolvedValue(sessions)
    renderWorkspace()

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)

    // Each row projects real session metadata (id + timestamp).
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('2026-08-01T10:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('12.5s')).toBeInTheDocument()
    expect(screen.getAllByText('Completed')).toHaveLength(2)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getAllByText('SCARA')).toHaveLength(2)
  })

  it('shows an empty state when no sessions exist', async () => {
    apiMocks.list.mockResolvedValue([])
    renderWorkspace()

    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders no detail/trace/replay UI — list only (spec "Minimal Scope")', async () => {
    apiMocks.list.mockResolvedValue(sessions)
    renderWorkspace()

    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('button', { name: /replay|export|trace/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /replay|export|trace/i })).not.toBeInTheDocument()
  })
})
