// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import * as echarts from 'echarts/core'
import { SessionDetail } from './SessionDetail'
import { triggerCsvDownload } from '@/features/sessions/export/session-csv'
import type { SessionSummary } from '../api/session-api'
import { installCanvasMock } from '@/test/canvas-mock'

/**
 * S6.3 — SessionDetail tabs (session-manager spec "Session Detail and
 * Comparison", P4 composability).
 *
 * The detail pane is PURELY COMPOSITIONAL: each tab mounts its own canonical
 * query and delegates ALL domain mapping to the S6 builders / export helper.
 * Invariants under test:
 *  - Lazy composition: the default Summary tab fetches ONLY `/summary` +
 *    `/statistics`; comparison/execution-trace/export queries fire only when
 *    their tab is activated.
 *  - Comparison: GET /sessions/{id}/comparison → comparisonBuilder → chart,
 *    with the global readout and observations rendered from the canonical
 *    response verbatim.
 *  - Timeline: GET /sessions/{id}/execution-trace → timelineBuilder → one
 *    marker per canonical event.
 *  - Export: GET /sessions/{id}/export → the canonical CSV string is passed
 *    VERBATIM into the download (mocked trigger — no client-side enrichment).
 */

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { get: apiMocks.get, post: apiMocks.post },
}))

vi.mock('@/features/sessions/export/session-csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/sessions/export/session-csv')>()
  return { ...actual, triggerCsvDownload: vi.fn() }
})

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

const comparisonFixture = {
  metrics: {
    global_rmse: 0.015,
    global_max_error: 0.042,
    global_avg_error: 0.009,
    per_joint: { rmse: [0.01, 0.02, 0.015], max_error: [0.03, 0.042, 0.028], avg_error: [0.006, 0.012, 0.009] },
    max_tracking_error: 0.031,
    avg_tracking_error: 0.007,
    max_velocity_deviation: [0.2, 0.15, 0.11],
    aligned_count: 120,
  },
  observations: [
    {
      id: 1,
      kind: 'TrackingDeviation',
      severity: 'Warning',
      artifact: { kind: 'ExecutionSession', id: '1' },
      location: { Waypoint: 3 },
      attributes: {},
      causes: [],
      related: [],
    },
  ],
  aligned_pair_count: 120,
}

const traceFixture = {
  metadata: {},
  samples: [],
  events: [
    { Started: { timestamp: 0 } },
    { WaypointReached: { timestamp: 3, waypoint: 1 } },
    { Completed: { timestamp: 10 } },
  ],
}

const motionTraceFixture = {
  samples: [
    { timestamp: 0, joints: [0.1, 0.2], velocities: [0.2, 0.4], target_joints: null, progress: 0, errors: [] },
    { timestamp: 5, joints: [0.3, 0.4], velocities: [0.6, 0.8], target_joints: null, progress: 0.5, errors: [] },
    { timestamp: 10, joints: [0.5, 0.6], velocities: [1.0, 1.2], target_joints: null, progress: 1, errors: [] },
  ],
}

const csvFixture = 'timestamp_s,joint_0,progress\n0.000000,0.100000,0.0000\n'

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionDetail session={session} />
    </QueryClientProvider>,
  )
}

interface RenderedSeries {
  type?: string
  data: Array<number | { value: number; itemStyle?: { color?: string } }>
}
interface RenderedOption {
  series: RenderedSeries[]
  // The adapter projects ChartModel.xAxis[].categories onto the ECharts axis
  // `data` field (mapAxis) — assert the real rendered labels here.
  xAxis?: Array<{ data?: string[] }>
}

function optionOf(el: HTMLElement): RenderedOption {
  const chart = echarts.getInstanceByDom(el)
  if (chart === undefined) throw new Error('no echarts instance on element')
  return chart.getOption() as unknown as RenderedOption
}

function valuesOf(option: RenderedOption, seriesIndex = 0): number[] {
  return option.series[seriesIndex].data.map((point) =>
    typeof point === 'object' ? point.value : point,
  )
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

// NOTE: every findByTestId('chart') below passes an explicit 5s timeout — the
// lazy ECharts chunk (React.lazy + dynamic import) can exceed testing-library's
// 1000ms default while echarts transforms cold under full-parallel vitest load.

beforeEach(() => {
  installCanvasMock()
  apiMocks.get.mockReset()
  apiMocks.post.mockReset()
  apiMocks.get.mockImplementation((url: string) => {
    if (url === '/sessions/1/summary') return Promise.resolve({ data: summaryFixture })
    if (url === '/sessions/1/statistics') return Promise.resolve({ data: statsFixture })
    if (url === '/sessions/1/comparison') return Promise.resolve({ data: comparisonFixture })
    if (url === '/sessions/1/execution-trace') return Promise.resolve({ data: traceFixture })
    if (url === '/sessions/1/trace') return Promise.resolve({ data: motionTraceFixture })
    if (url === '/sessions/1/export') return Promise.resolve({ data: csvFixture })
    return Promise.reject(new Error(`unexpected URL ${url}`))
  })
  vi.mocked(triggerCsvDownload).mockClear()
})
afterEach(() => cleanup())

describe('SessionDetail tabs — purely compositional (P4)', () => {
  it('defaults to Summary and fetches ONLY /summary + /statistics (lazy tabs)', async () => {
    renderDetail()
    await screen.findByText('480 samples')

    expect(apiMocks.get.mock.calls.map(([url]) => url)).toEqual([
      '/sessions/1/summary',
      '/sessions/1/statistics',
    ])
    // The tab triggers exist but the data-heavy tabs stay unmounted.
    expect(screen.getByRole('tab', { name: 'Comparison' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Trace' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Export' })).toBeInTheDocument()
  })

  it('Comparison tab: fetches /comparison, renders the per-joint RMSE chart verbatim + readout + observations', async () => {
    renderDetail()
    await screen.findByText('480 samples')
    fireEvent.click(screen.getByRole('tab', { name: 'Comparison' }))

    const chart = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()

    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/comparison')
    // Per-joint RMSE bars — the canonical values, not recomputed (I5).
    expect(valuesOf(optionOf(chart))).toEqual([0.01, 0.02, 0.015])
    expect(optionOf(chart).xAxis?.[0]?.data).toEqual(['Joint 1', 'Joint 2', 'Joint 3'])
    // Readout from metrics verbatim.
    expect(screen.getByText('0.015')).toBeInTheDocument() // global_rmse
    expect(screen.getByText('0.042')).toBeInTheDocument() // global_max_error
    expect(screen.getByText('120')).toBeInTheDocument() // aligned_pair_count
    // Canonical observations rendered structurally.
    expect(screen.getByText('Tracking Deviation')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getByText('wp3')).toBeInTheDocument()
  })

  it('Timeline tab: fetches /execution-trace and renders one marker per canonical event', async () => {
    renderDetail()
    await screen.findByText('480 samples')
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))

    const chart = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()

    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/execution-trace')
    expect(optionOf(chart).series[0].data).toHaveLength(3)
    expect(optionOf(chart).xAxis?.[0]?.data).toEqual([
      'Started · 0:00',
      'Waypoint Reached · 0:03',
      'Completed · 0:10',
    ])
  })

  it('Trace tab: fetches /trace and renders one line series per joint with mm:ss time axis', async () => {
    renderDetail()
    await screen.findByText('480 samples')
    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }))

    const chart = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()

    // Canonical source (spec trace-chart): data comes from GET /sessions/{id}/trace.
    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/trace')
    const option = optionOf(chart)
    // One line series per joint (2 joints in the fixture), positions verbatim.
    expect(option.series).toHaveLength(2)
    expect(option.series.map((series) => series.type)).toEqual(['line', 'line'])
    expect(valuesOf(option, 0)).toEqual([0.1, 0.3, 0.5])
    // X axis = time, formatted mm:ss.
    expect(option.xAxis?.[0]?.data).toEqual(['0:00', '0:05', '0:10'])
  })

  it('Export tab: fetches /export and downloads the canonical CSV verbatim', async () => {
    renderDetail()
    await screen.findByText('480 samples')
    fireEvent.click(screen.getByRole('tab', { name: 'Export' }))

    const button = await screen.findByRole('button', { name: 'Export CSV' })

    expect(apiMocks.get).toHaveBeenCalledWith('/sessions/1/export', { responseType: 'text' })
    fireEvent.click(button)
    expect(vi.mocked(triggerCsvDownload)).toHaveBeenCalledExactlyOnceWith({
      filename: 'session-1-trace.csv',
      content: csvFixture,
      mimeType: 'text/csv;charset=utf-8',
    })
  })
})
