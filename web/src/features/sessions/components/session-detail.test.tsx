// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { SessionDetail } from './SessionDetail'
import type { SessionSummary } from '../api/session-api'

/**
 * S5.5 — SessionDetail preview (session-browser spec: "Trace Preview").
 * The preview renders sample_count / duration / joint_count from
 * `/summary` and statistics from `/statistics` — it SHALL NOT call
 * `/trace` or `/replay` (negative scenarios pinned here, invariant I4:
 * every displayed field maps to a canonical endpoint response).
 */

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { get: apiMocks.get, post: apiMocks.post },
}))

const session: SessionSummary = {
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
}

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

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionDetail session={session} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMocks.get.mockReset()
  apiMocks.post.mockReset()
  apiMocks.get.mockImplementation((url: string) => {
    if (url === '/sessions/1/summary') return Promise.resolve({ data: summaryFixture })
    if (url === '/sessions/1/statistics') return Promise.resolve({ data: statsFixture })
    return Promise.reject(new Error(`unexpected URL ${url}`))
  })
})
afterEach(() => cleanup())

describe('SessionDetail — summary preview from /summary (spec "Preview without replay")', () => {
  it('renders sample_count, duration and joint_count from /summary', async () => {
    renderDetail()

    expect(await screen.findByText('480 samples')).toBeInTheDocument()
    expect(screen.getByText('12.5s')).toBeInTheDocument()
    expect(screen.getByText('4 joints')).toBeInTheDocument()
    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/summary')
  })

  it('renders statistics readout from /statistics (canonical fields)', async () => {
    renderDetail()

    expect(await screen.findByText('38.4 Hz')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument() // event_count
    expect(screen.getByText('0.012')).toBeInTheDocument() // max_tracking_error
  })

  it('shows a loading state while the summary query is pending', () => {
    apiMocks.get.mockImplementation(() => new Promise(() => {}))
    renderDetail()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows an error state when a detail endpoint fails', async () => {
    apiMocks.get.mockRejectedValue(new Error('summary unavailable'))
    renderDetail()
    expect(await screen.findByText('summary unavailable')).toBeInTheDocument()
  })
})

describe('SessionDetail — preview never triggers full trace or replay (negative)', () => {
  it('does NOT call /trace or /replay for the preview', async () => {
    renderDetail()
    await screen.findByText('480 samples')

    expect(apiMocks.get).not.toHaveBeenCalledWith('/sessions/1/trace')
    expect(apiMocks.get).not.toHaveBeenCalledWith('/sessions/1/replay')
    expect(apiMocks.post).not.toHaveBeenCalled()
    // The ONLY detail calls are the canonical summary + statistics endpoints.
    expect(apiMocks.get.mock.calls.map(([url]) => url)).toEqual([
      '/sessions/1/summary',
      '/sessions/1/statistics',
    ])
  })
})
