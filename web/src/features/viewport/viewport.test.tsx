// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { Viewport } from './viewport'
import { useSceneStore } from './store'
import { installCanvasMock } from '@/test/canvas-mock'

installCanvasMock()

/**
 * Viewport retry (resilience-matrix-frontend spec, requirement "Retry Buttons
 * in Viewport"): when the scene load fails (backend offline / timeout), the
 * viewport shows the error message AND a "Reintentar" button, the loading
 * spinner is stopped, and clicking the button re-attempts the scene load.
 */
const loadSceneMocks = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('@/features/viewport/synchronization/use-scene-loader', () => ({
  useLoadScene: () => loadSceneMocks,
  useLoadRobot: () => ({ mutate: vi.fn() }),
  useLoadRobotFromUrdf: () => ({ mutate: vi.fn(), isPending: false }),
  resetSceneRequestOrdering: () => {},
}))

describe('Viewport — retry button on load error (resilience-matrix spec)', () => {
  beforeEach(() => {
    loadSceneMocks.mutate.mockClear()
    act(() => {
      useSceneStore.setState({ error: null, loading: false, data: null } as never)
    })
  })
  afterEach(() => cleanup())

  it('shows the error message and a Reintentar button when the scene load failed', () => {
    act(() => {
      useSceneStore.setState({ error: 'Backend is offline', loading: false, data: null } as never)
    })
    render(<Viewport />)
    expect(screen.getByText('Backend is offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    // Coherent state: the loading spinner is NOT shown (setError clears loading).
    expect(screen.queryByText('Loading scene...')).not.toBeInTheDocument()
  })

  it('clicking Reintentar clears the error and re-attempts the scene load', async () => {
    act(() => {
      useSceneStore.setState({ error: 'Backend is offline', loading: false, data: null } as never)
    })
    render(<Viewport />)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(loadSceneMocks.mutate).toHaveBeenCalledTimes(1))
    // The error is cleared so a retry that succeeds can paint the scene.
    expect(useSceneStore.getState().error).toBeNull()
  })

  it('shows the catalog CTA when the scene load fails with a not_found code (matrix Esc 5)', () => {
    // Robot inexistente: el backend responde 404 not_found; el ErrorBox debe
    // ofrecer "Volver al catálogo" (describeError code→CTA), no un Reintentar genérico.
    act(() => {
      useSceneStore.setState({
        error: 'Robot not found',
        errorCode: 'not_found',
        loading: false,
        data: null,
      } as never)
    })
    render(<Viewport />)
    // describeError renderiza el CTA del código not_found + el mensaje del backend.
    expect(screen.getByText('Robot not found — return to the catalog — Robot not found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver al catálogo' })).toBeInTheDocument()
    // Coherent state: no spinner, retry not mislabeled.
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
    expect(screen.queryByText('Loading scene...')).not.toBeInTheDocument()
  })

  it('shows no dead Fit Robot button when the scene is loaded (visual audit V2)', () => {
    act(() => {
      useSceneStore.setState({ error: null, loading: false, data: { frames: [] } as never } as never)
    })
    render(<Viewport />)
    expect(screen.queryByRole('button', { name: 'Fit Robot' })).not.toBeInTheDocument()
  })
})
