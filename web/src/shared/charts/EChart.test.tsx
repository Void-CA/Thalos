// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { EChart } from './EChart'
import { modelsEqual } from './EChartInner'
import type { ChartModel } from './types'
import { installCanvasMock } from '@/test/canvas-mock'

const lineModel: ChartModel = {
  series: [{ name: 'Manipulability', type: 'line', data: [0.2, 0.05, 0.3] }],
  xAxis: [{ type: 'value', name: 'Waypoint', min: 0, max: 2 }],
  tooltip: { trigger: 'axis' },
}

// NOTE: the findByTestId('chart' / 'chart-empty') waits below pass an explicit
// 5s timeout — the lazy chunk (React.lazy + dynamic import) resolves
// asynchronously and can exceed testing-library's 1000ms default under
// full-parallel vitest load.

beforeEach(() => installCanvasMock())
afterEach(() => cleanup())

describe('EChart wrapper (Recharts)', () => {
  it('renders a declarative chart container that reflects the model', async () => {
    render(<EChart model={{ ...lineModel, title: 'Manipulability' }} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    expect(el).toBeInTheDocument()
    // Title is rendered above the chart.
    expect(screen.getByText('Manipulability')).toBeInTheDocument()
    // A line series renders as an SVG geometry (Recharts draws the series data).
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelectorAll('.recharts-line').length).toBeGreaterThan(0)
  })

  it('renders no chart for the empty state and shows the empty message instead', async () => {
    render(<EChart model={{ series: [], xAxis: [], empty: { message: 'No manipulability data available' } }} />)
    const emptyEl = await screen.findByTestId('chart-empty', {}, { timeout: 5000 })
    expect(emptyEl).toHaveTextContent('No manipulability data available')
    expect(screen.queryByTestId('chart')).toBeNull()
  })
})

describe('modelsEqual — structural content equality (spec "Chart Content Equality Guard")', () => {
  it('compares tooltip formatter functions by reference', () => {
    const formatter = (params: unknown) => String(params)
    const withFormatter = (f: (params: unknown) => string): ChartModel => ({
      ...lineModel,
      tooltip: { trigger: 'axis', formatter: f },
    })
    // Same function reference → equal content, even though the model object is fresh.
    expect(modelsEqual(withFormatter(formatter), withFormatter(formatter))).toBe(true)
    // Different function reference → content differs (cannot prove behavior).
    expect(modelsEqual(withFormatter(formatter), withFormatter((params) => String(params)))).toBe(false)
  })

  it('is independent of object key order (no JSON.stringify ordering trap)', () => {
    const a: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2] }],
      xAxis: [{ type: 'value' }],
      tooltip: { trigger: 'item' },
    }
    const b: ChartModel = {
      tooltip: { trigger: 'item' },
      xAxis: [{ type: 'value' }],
      series: [{ name: 's', type: 'line', data: [1, 2] }],
    }
    expect(modelsEqual(a, b)).toBe(true)
  })

  it('detects real content differences in nested series data', () => {
    const base: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2] }],
      xAxis: [{ type: 'value' }],
    }
    expect(
      modelsEqual(base, {
        series: [{ name: 's', type: 'line', data: [1, 3] }],
        xAxis: [{ type: 'value' }],
      }),
    ).toBe(false)
  })
})