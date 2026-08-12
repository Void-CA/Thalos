// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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
 * (kind 'tool'). P0-B reorg: the last tool entry (/analysis) was REMOVED —
 * Workspace Analysis is a Robot accordion tool now, so no tool group (and no
 * divider) renders. Guard state comes from the same registry + WorkflowState
 * contract the GuardedRoute enforces: an unmet requirement aria-disables the
 * link and prevents its click.
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

describe('TopBar — pipeline stages only (P0-B reorg: no tool group anymore)', () => {
  it('renders every stage link and no tool link / divider (Workspace Analysis is a Robot accordion tool)', () => {
    seedFlags({ robotLoaded: true })
    renderTopBar('/')

    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim() ?? '')
    expect(labels).toEqual([
      'Robot',
      'Escena',
      'Programación',
      'Evaluación',
      'Ejecución',
      'Sesiones',
      'Configuración',
    ])

    // No auxiliary tool entries remain in the registry → the decorative
    // divider (which only renders when tool links exist) is gone too.
    expect(screen.queryByRole('link', { name: 'Workspace Analysis' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-divider')).not.toBeInTheDocument()
  })

  it('aria-disables stage links whose guards are unmet (guard state, no navigation)', async () => {
    seedFlags({ robotLoaded: false })
    const router = renderTopBar('/')

    // Escena requires robotLoaded — unmet → aria-disabled and click prevented.
    const scene = screen.getByRole('link', { name: 'Escena' })
    expect(scene).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(scene)
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
