// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import { AlternativesPanel } from './alternatives-panel'
import type { RepairOptionWire, RepairOptionsWire } from '@/shared/contracts/repair-options'

/**
 * S4 — AlternativesPanel on the canonical endpoint (spec alternatives-panel-react).
 *
 * - Canonical source (I1): the panel fetches `POST /plan/repair/options` and
 *   NOTHING else. The api client has no legacy `/plan/analyze/alternatives`
 *   route anymore (criterion C1/C2), so calling it here cannot compile — the
 *   apiClient mock records every URL the panel actually posts to.
 * - The panel is a PURE CONSUMER (C3): it renders the builder's presentation
 *   model verbatim — no local mapping, no formatting.
 * - Empty state derives from the domain (C4): `repairs = []` → the builder's
 *   `empty.message` ("No alternatives available"), never a component guess.
 */

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { post: apiMocks.post },
}))

function option(overrides: Partial<RepairOptionWire> = {}): RepairOptionWire {
  return {
    region_id: 1,
    strategy: 'lift-tcp',
    status: 'available',
    improvement: 0.15,
    metrics_before: { manipulability: 0.2146, smoothness: 0.8 },
    metrics_after: { manipulability: 0.3614, smoothness: 0.9 },
    ...overrides,
  }
}

function response(repairs: RepairOptionWire[]): RepairOptionsWire {
  return { repairs }
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AlternativesPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMocks.post.mockReset()
})
afterEach(() => cleanup())

describe('AlternativesPanel — canonical /plan/repair/options (S4)', () => {
  it('POSTs /plan/repair/options and renders one card per option with region, strategy, status, improvement and metrics', async () => {
    apiMocks.post.mockResolvedValue({
      data: response([
        option(),
        option({
          region_id: 2,
          strategy: 'rotate-tool',
          improvement: 0.08,
          metrics_before: { manipulability: 0.12, smoothness: 0.6 },
          metrics_after: { manipulability: 0.22, smoothness: 0.75 },
        }),
      ]),
    })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Generate Repair Options' }))

    expect(await screen.findByText('Lift Tcp')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getAllByText('available')).toHaveLength(2)
    expect(screen.getByText('+15.0%')).toBeInTheDocument()
    expect(screen.getByText('Rotate Tool')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('+8.0%')).toBeInTheDocument()
    // Metrics before/after rendered verbatim from the builder view — each card
    // projects ITS OWN canonical metrics (no shared/global values).
    expect(screen.getByText('0.215 → 0.361')).toBeInTheDocument()
    expect(screen.getByText('0.120 → 0.220')).toBeInTheDocument()
    expect(apiMocks.post).toHaveBeenCalledWith('/plan/repair/options', {})
  })

  it('never calls the deprecated /plan/analyze/alternatives endpoint (I1 negative)', async () => {
    apiMocks.post.mockResolvedValue({ data: response([option()]) })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Generate Repair Options' }))

    await screen.findByText('Lift Tcp')
    expect(apiMocks.post).not.toHaveBeenCalledWith('/plan/analyze/alternatives', {})
  })

  it('shows the domain empty state when the backend returns zero options (C4)', async () => {
    apiMocks.post.mockResolvedValue({ data: response([]) })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Generate Repair Options' }))

    expect(await screen.findByText('No alternatives available')).toBeInTheDocument()
  })
})
