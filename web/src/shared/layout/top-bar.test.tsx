// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import '@testing-library/jest-dom/vitest'
import { TopBar } from './top-bar'
import { useSceneStore } from '@/features/viewport/store'
import { useSemanticEditor } from '@/features/semantic/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import { useAnalysisStore } from '@/features/analysis/store'
import type { SceneData } from '@/features/viewport/types'

/**
 * TopBar navigation tests (auxiliary-tools-navigation spec, PR-D).
 *
 * The top-bar groups registry entries by kind: pipeline stage links first
 * (kind default 'stage'), a decorative divider, then auxiliary tool links
 * (kind 'tool' — /analysis). Guard state comes from the same registry +
 * WorkflowState contract the GuardedRoute enforces: an unmet requirement
 * aria-disables the link and prevents its click.
 */
function seedFlags(opts: { robotLoaded?: boolean } = {}) {
  const { robotLoaded = true } = opts
  act(() => {
    useSceneStore.setState({ data: robotLoaded ? ({} as SceneData) : null })
    useSemanticEditor.setState({ result: null, dirty: 0 })
    useExecutionStore.setState({ status: 'idle' })
    useAnalysisStore.setState({ report: null })
  })
}

function renderTopBar(initialPath: string) {
  const router = createMemoryRouter([{ path: '*', element: <TopBar /> }], {
    initialEntries: [initialPath],
  })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  useSceneStore.getState().reset()
  useSemanticEditor.getState().reset()
  useExecutionStore.setState({ status: 'idle' })
  useAnalysisStore.setState({ report: null })
})
afterEach(() => cleanup())

describe('TopBar — pipeline stages, divider, then tool links (auxiliary-tools-navigation spec)', () => {
  it('renders every stage link first, then the Analysis tool link after a divider', () => {
    seedFlags({ robotLoaded: true })
    renderTopBar('/')

    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim() ?? '')
    expect(labels).toEqual([
      'Robot',
      'Escena',
      'Programación',
      'Ejecución',
      'Sesiones',
      'Configuración',
      'Analysis',
    ])

    // Visual separator between the stage group and the tool group (spec:
    // Tools grouped with divider). aria-hidden: decorative, not read aloud.
    const divider = screen.getByTestId('nav-divider')
    expect(divider).toHaveAttribute('aria-hidden', 'true')
    const lastStage = screen.getByRole('link', { name: 'Configuración' })
    const analysis = screen.getByRole('link', { name: 'Analysis' })
    expect(
      lastStage.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      divider.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('navigates to /analysis when the Analysis tool link is clicked (robot loaded)', async () => {
    seedFlags({ robotLoaded: true })
    const router = renderTopBar('/')

    fireEvent.click(screen.getByRole('link', { name: 'Analysis' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analysis'))
  })

  it('disables the Analysis tool link when no robot is loaded (guard state, no navigation)', async () => {
    seedFlags({ robotLoaded: false })
    const router = renderTopBar('/')

    const analysis = screen.getByRole('link', { name: 'Analysis' })
    expect(analysis).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(analysis)
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('TopBar — version label (visual audit V5)', () => {
  it('shows the MVP version v1.0.0-mvp (was v0.1.0)', () => {
    seedFlags({ robotLoaded: true })
    renderTopBar('/')
    expect(screen.getByText('v1.0.0-mvp')).toBeInTheDocument()
    expect(screen.queryByText('v0.1.0')).not.toBeInTheDocument()
  })
})
