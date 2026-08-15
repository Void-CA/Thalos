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
 * TopBar navigation tests (auxiliary-tools-navigation spec, PR-D, revised).
 *
 * The TopBar renders ONLY brand + tool links: stage navigation lives in the
 * Stepper. The Demos workspace (showcase-scenarios, D5) is the sole tool entry
 * (kind 'tool') today, with no `requires` — so no tool link is guard-blocked
 * with the current registry. WorkspaceNavLink keeps the guard contract
 * (aria-disabled + click prevention) defensively for future tool entries;
 * the stage guard behavior is pinned in the Stepper/router suites.
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

describe('TopBar — brand + tool links only (stage navigation lives in the Stepper)', () => {
  it('renders only the Demos tool link (no stage links, no divider)', () => {
    seedFlags({ robotLoaded: true })
    renderTopBar('/')

    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim() ?? '')
    expect(labels).toEqual(['Demos'])

    // No divider — nothing separates a tool group from stage links anymore.
    expect(screen.queryByTestId('nav-divider')).not.toBeInTheDocument()
    // No stage links: the Stepper owns stage navigation (and no hidden tool
    // surfaced, e.g. the removed Workspace Analysis route).
    for (const name of ['Robot', 'Scene', 'Programming', 'Evaluation', 'Execution', 'Sessions', 'Configuration']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: 'Workspace Analysis' })).not.toBeInTheDocument()

    const demos = screen.getByRole('link', { name: 'Demos' })
    // The tool link is unblocked — Demos requires no workflow flags.
    expect(demos).not.toHaveAttribute('aria-disabled')
  })

  it('keeps tool links enabled regardless of stage guard state (Demos requires no flags)', () => {
    // Stage guards unmet (robotLoaded=false) — tool links are unaffected.
    seedFlags({ robotLoaded: false })
    const router = renderTopBar('/')

    const demos = screen.getByRole('link', { name: 'Demos' })
    expect(demos).not.toHaveAttribute('aria-disabled')
    fireEvent.click(demos)
    expect(router.state.location.pathname).toBe('/demos')
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
