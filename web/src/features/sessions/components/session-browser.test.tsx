// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { SessionBrowser } from './SessionBrowser'
import type { SessionSummary } from '../api/session-api'

/**
 * S5.3/S5.5 — SessionBrowser behavior (session-browser + session-manager spec).
 *
 * - C2/I4 (React Query as CACHE, never a model): the component fetches through
 *   the canonical api module (mocked at the apiClient layer); every row MUST
 *   trace to `GET /sessions` data. No Zustand store is imported anywhere in
 *   the feature (grep evidence in apply-progress) and the rows render ONLY
 *   after the canonical query resolves — a parallel store would make this mock
 *   irrelevant and the assertions below would fail.
 * - C3: filtering + search are presentation-only transformations over the
 *   cached list — the component never enriches session fields.
 * - C4: loading/error/empty states derive from the endpoint query.
 */

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { get: apiMocks.get, post: apiMocks.post },
}))

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
    plan_id: 'plan-c',
    source: 'live',
    status: 'Failed',
    started_at: '2026-08-01T12:00:00Z',
    paused_at: null,
    completed_at: null,
    duration: 3.0,
    joint_count: 4,
    robot_name: 'SCARA',
  },
  {
    id: 4,
    plan_id: 'plan-d',
    source: 'live',
    status: 'Running',
    started_at: '2026-08-01T12:30:00Z',
    paused_at: null,
    completed_at: null,
    duration: 20.0,
    joint_count: 6,
    robot_name: 'Delta',
  },
]

const summaryFixture = {
  session_id: 1,
  duration: 12.5,
  sample_count: 480,
  joint_count: 4,
  max_velocity: [1.2, 0.9, 0.7, 0.4],
  mean_velocity: [0.5, 0.4, 0.3, 0.2],
  path_length: 3.4,
  recording_source: 'live',
  status: 'Completed',
}

const statsFixture = {
  duration: 12.5,
  sample_count: 480,
  sample_rate: 38.4,
  joint_count: 4,
  path_length: 3.4,
  max_joint_velocity: [1.2, 0.9, 0.7, 0.4],
  avg_joint_velocity: [0.5, 0.4, 0.3, 0.2],
  max_tracking_error: 0.012,
  avg_tracking_error: 0.004,
  event_count: 7,
  waypoints_completed: 5,
}

/** Route the apiClient mock: list always; detail endpoints for session 1. */
function mockApi(list: SessionSummary[]) {
  apiMocks.get.mockImplementation((url: string) => {
    if (url === '/sessions') return Promise.resolve({ data: list })
    if (url === '/sessions/1/summary') return Promise.resolve({ data: summaryFixture })
    if (url === '/sessions/1/statistics') return Promise.resolve({ data: statsFixture })
    return Promise.reject(new Error(`unexpected URL ${url}`))
  })
}

function renderBrowser() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionBrowser />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMocks.get.mockReset()
  apiMocks.post.mockReset()
})
afterEach(() => cleanup())

describe('SessionBrowser — canonical data flow (C2/I4)', () => {
  it('renders one row per session from GET /sessions through the React Query cache', async () => {
    mockApi(sessions)
    renderBrowser()

    await screen.findAllByRole('listitem')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(apiMocks.get).toHaveBeenCalledWith('/sessions')
    expect(apiMocks.get).toHaveBeenCalledTimes(1)

    // Rows project canonical fields verbatim (id, status, plan_id, robot_name).
    // Status assertions scoped to the list — the same words are filter chips.
    const list = screen.getByRole('list')
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(within(list).getByText('plan-a')).toBeInTheDocument()
    expect(within(list).getAllByText('SCARA')).toHaveLength(2)
    expect(within(list).getByText('Failed')).toBeInTheDocument()
    expect(within(list).getByText('Running')).toBeInTheDocument()
  })

  it('never writes to a Zustand store — rows render only once the canonical query resolves (I4)', async () => {
    let resolveList: (v: { data: SessionSummary[] }) => void
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/sessions') {
        return new Promise<{ data: SessionSummary[] }>((resolve) => { resolveList = resolve })
      }
      return Promise.reject(new Error(`unexpected URL ${url}`))
    })
    renderBrowser()

    // While the query is pending no rows exist — nothing is pre-populated.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    await act(async () => { resolveList({ data: sessions }) })
    expect(await screen.findAllByRole('listitem')).toHaveLength(4)
  })
})

describe('SessionBrowser — endpoint-derived states (C4)', () => {
  it('shows a loading state while GET /sessions is pending', () => {
    apiMocks.get.mockImplementation(() => new Promise(() => {}))
    renderBrowser()
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument()
  })

  it('shows an error state when GET /sessions fails', async () => {
    apiMocks.get.mockRejectedValue(new Error('network down'))
    renderBrowser()
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('shows an empty state derived from the endpoint (no sessions)', async () => {
    mockApi([])
    renderBrowser()
    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
  })
})

describe('SessionBrowser — presentation-only filters and search (C3)', () => {
  it('filters by a single status', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.queryByText('#3')).not.toBeInTheDocument()
    expect(screen.queryByText('#4')).not.toBeInTheDocument()
  })

  it('supports multi-select (Completed AND Failed) and All', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.queryByText('#4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('searches plan_id case-insensitively with partial matching', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'PLAN-A' },
    })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('#1')).toBeInTheDocument()
  })

  it('searches robot_name case-insensitively', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'scara' },
    })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
  })

  it('combines status filter and search (both are over the same cached list)', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'delta' },
    })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('#2')).toBeInTheDocument()
  })
})

describe('SessionBrowser — master-detail (session-manager spec)', () => {
  it('loads the detail pane (summary + statistics) when a session is selected', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.click(screen.getByRole('button', { name: /#1/ }))
    await screen.findByText('480 samples')
    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/summary')
    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/statistics')
  })

  it('shows a placeholder until a session is selected', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')
    expect(screen.getByText(/select a session/i)).toBeInTheDocument()
  })
})

describe('SessionBrowser — preview never triggers full trace or replay (spec)', () => {
  it('does not call /trace or /replay for the preview', async () => {
    mockApi(sessions)
    renderBrowser()
    await screen.findAllByRole('listitem')

    fireEvent.click(screen.getByRole('button', { name: /#1/ }))
    await screen.findByText('480 samples')

    expect(apiMocks.get).not.toHaveBeenCalledWith('/sessions/1/trace')
    expect(apiMocks.get).not.toHaveBeenCalledWith('/sessions/1/replay')
    expect(apiMocks.post).not.toHaveBeenCalled()
  })
})
