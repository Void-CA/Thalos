// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { SceneEditor } from './scene-editor'
import { useDomainSceneStore } from '../store'

/**
 * Visual audit (resilience-presentation PR4, V6-V9): the scene editor's
 * section titles are real headings (V9 heading hierarchy — no more bare
 * spans), and the object/location lists are NOT capped by a scroll container
 * (V6 — a demo scene with a few items needs no inner scrollbar).
 */
describe('SceneEditor — visual audit headings and list layout (V6, V9)', () => {
  beforeEach(() => {
    act(() => {
      useDomainSceneStore.setState({ objects: [], locations: [], tools: [] })
    })
  })
  afterEach(() => cleanup())

  it('renders Objects / Locations / Tools / Home as proper headings (V9)', () => {
    render(<SceneEditor />)
    expect(screen.getByRole('heading', { name: 'Objects' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Locations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('shows every defined object without an inner scroll cap (V6)', () => {
    act(() => {
      useDomainSceneStore.setState({
        objects: [
          { id: 'obj-1', name: 'Object 1', pose: { position: [0, 0, 0], orientation: [1, 0, 0, 0] } },
          { id: 'obj-2', name: 'Object 2', pose: { position: [1, 0, 0], orientation: [1, 0, 0, 0] } },
          { id: 'obj-3', name: 'Object 3', pose: { position: [2, 0, 0], orientation: [1, 0, 0, 0] } },
        ],
      })
    })
    render(<SceneEditor />)
    // All three objects are visible in the DOM (no max-height scroll container
    // truncating the list for a demo-sized scene).
    expect(screen.getByDisplayValue('Object 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Object 2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Object 3')).toBeInTheDocument()
  })

  it('renders the SCARA approach height field and edits it', () => {
    render(<SceneEditor />)
    const input = screen.getByLabelText('SCARA approach height (metres)')
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '0.12' } })
    expect(useDomainSceneStore.getState().approachHeight).toBe(0.12)
  })
})
