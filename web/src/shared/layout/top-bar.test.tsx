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
 * (kind 'tool'). The Demos workspace (showcase-scenarios, D5) is the current
 * tool entry — it renders after the divider. Guard state comes from the same
 * registry + WorkflowState contract the GuardedRoute enforces: an unmet
 * requirement aria-disables the link and prevents its click.
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

describe('TopBar — pipeline stages, then a divider, then tool links (kind model)', () => {
  it('renders stage links, the decorative divider, and the Demos tool link after it', () => {
    seedFlags({ robotLoaded: true })
    renderTopBar('/')

    const labels = screen.getAllByRole('link').map((l) => l.textContent?.trim() ?? '')
    expect(labels).toEqual([
      'Robot',
      'Scene',
      'Programming',
      'Evaluation',
      'Execution',
      'Sessions',
      'Configuration',
      'Demos',
    ])

    // The Demos workspace (kind 'tool', showcase-scenarios D5) renders in the
    // auxiliary group AFTER the divider — the divider exists only when tool
    // links exist, and Demos is the sole tool entry today (the labels array
    // above pins Demos as the last link, i.e. after every stage link).
    expect(screen.queryByRole('link', { name: 'Workspace Analysis' })).not.toBeInTheDocument()
    const divider = screen.getByTestId('nav-divider')
    expect(divider).toBeInTheDocument()
    const demos = screen.getByRole('link', { name: 'Demos' })
    // The divider is aria-hidden — the link carries the accessible name.
    expect(divider).toHaveAttribute('aria-hidden')
    expect(demos).not.toHaveAttribute('aria-disabled')
  })

  it('aria-disables stage links whose guards are unmet (guard state, no navigation)', async () => {
    seedFlags({ robotLoaded: false })
    const router = renderTopBar('/')

    // Scene requires robotLoaded — unmet → aria-disabled and click prevented.
    const scene = screen.getByRole('link', { name: 'Scene' })
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
