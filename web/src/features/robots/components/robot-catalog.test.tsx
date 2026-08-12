// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RobotCatalog } from './robot-catalog'

/**
 * Catalog retry (resilience-matrix-frontend spec, requirement "Retry Buttons
 * in Catalog"): when the robot list fetch times out or the backend is offline,
 * the catalog shows the error message AND a "Retry" button, the Loader2
 * spinner is stopped, and clicking the button refetches the robot list.
 */
const useRobotsMocks = vi.hoisted(() => ({
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}))

vi.mock('@/features/robots/api/use-robots', () => ({
  useRobots: () => useRobotsMocks,
}))

vi.mock('@/features/robots/store', () => ({
  useRobotStore: (selector: (s: unknown) => unknown) => selector({
    robots: [],
    selectedId: null,
    select: vi.fn(),
  }),
  useSelectedRobot: () => null,
}))

vi.mock('@/features/viewport/synchronization/use-scene-loader', () => ({
  useLoadRobotFromUrdf: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('RobotCatalog — retry button on fetch error (resilience-matrix spec)', () => {
  beforeEach(() => {
    useRobotsMocks.isLoading = false
    useRobotsMocks.error = null
    useRobotsMocks.refetch.mockClear()
  })
  afterEach(() => cleanup())

  it('shows the error message and a Retry button instead of an infinite spinner', () => {
    useRobotsMocks.error = new Error('Request timed out')
    render(<RobotCatalog />)
    expect(screen.getByText(/Request timed out/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    // The Loader2 spinner is stopped (no loading state).
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clicking Retry refetches the robot list', async () => {
    useRobotsMocks.error = new Error('Request timed out')
    render(<RobotCatalog />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(useRobotsMocks.refetch).toHaveBeenCalledTimes(1))
  })
})
