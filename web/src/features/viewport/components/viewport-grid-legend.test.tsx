// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import { ViewportGridLegend, formatGridSquare, gridLegendLabel, gridSquareSize } from './viewport-grid-legend'
import { useSceneStore } from '../store'
import type { SceneData } from '../types'

/**
 * viewport-grid-legend (spec viewport-grid-legend): floating legend showing
 * what each SceneGrid square equals ("grid = 80 mm"), computed from the SAME
 * size SceneGrid uses — `size = max(refDim*4, 0.5)` over 10 divisions — so the
 * legend never desyncs from the rendered grid.
 *
 * UNIT POLICY: unambiguous, mm/m only, NO cm. Square < 1 m → whole mm
 * (minimum 1); square ≥ 1 m → m with up to 2 decimals. Hidden when the grid
 * is hidden (no scene data).
 */

const sceneData: SceneData = {
  frames: [],
  links: [],
  jointAxes: [],
  twists: [],
  primitives: [],
  referenceDimension: 0.2,
}

beforeEach(() => {
  useSceneStore.getState().reset()
})
afterEach(() => cleanup())

describe('gridSquareSize — mirrors SceneGrid size = max(refDim*4, 0.5) / 10', () => {
  it('derives the per-square size from referenceDimension', () => {
    // size = max(0.2*4, 0.5) = 0.8; 0.8 / 10 = 0.08 m per square.
    expect(gridSquareSize(0.2)).toBeCloseTo(0.08, 10)
    // Small robots never drop below the 0.5 floor: 0.1 → max(0.4, 0.5) = 0.5.
    expect(gridSquareSize(0.1)).toBeCloseTo(0.05, 10)
  })

  it('falls back to referenceDimension 1.0 when absent', () => {
    expect(gridSquareSize(undefined)).toBeCloseTo(0.4, 10)
    expect(gridSquareSize(null)).toBeCloseTo(0.4, 10)
  })
})

describe('formatGridSquare — unambiguous mm/m unit policy, no cm', () => {
  it('renders sub-meter squares as whole mm (minimum 1)', () => {
    expect(formatGridSquare(0.08)).toBe('80 mm')
    expect(formatGridSquare(0.999)).toBe('999 mm')
    expect(formatGridSquare(0.0004)).toBe('1 mm') // floor at 1 mm
  })

  it('renders meter squares as m with up to 2 decimals', () => {
    expect(formatGridSquare(1.0)).toBe('1 m')
    expect(formatGridSquare(1.2)).toBe('1.2 m')
    expect(formatGridSquare(1.234)).toBe('1.23 m')
  })
})

describe('gridLegendLabel — the legend text', () => {
  it('renders "grid = {value} {unit}" from the scene reference dimension', () => {
    // refDim 0.2 → square 0.08 m = 80 mm.
    expect(gridLegendLabel(0.2)).toBe('grid = 80 mm')
    expect(gridLegendLabel(2.5)).toBe('grid = 1 m') // square exactly 1 m
  })
})

describe('ViewportGridLegend — rendered chip', () => {
  it('shows the per-square metric when scene data is present', () => {
    act(() => {
      useSceneStore.setState({ data: sceneData })
    })
    render(<ViewportGridLegend />)
    expect(screen.getByTestId('viewport-grid-legend')).toHaveTextContent('grid = 80 mm')
  })

  it('is hidden when there is no scene data (grid hidden)', () => {
    act(() => {
      useSceneStore.setState({ data: null })
    })
    render(<ViewportGridLegend />)
    expect(screen.queryByTestId('viewport-grid-legend')).not.toBeInTheDocument()
  })
})
