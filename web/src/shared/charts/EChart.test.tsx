// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import * as echarts from 'echarts/core'
import { EChart } from './EChart'
import { modelsEqual } from './EChartInner'
import type { ChartModel } from './types'
import * as adapter from './adapter'
import { installCanvasMock, lastResizeObserverMock } from '@/test/canvas-mock'

const lineModel: ChartModel = {
  series: [{ name: 'Manipulability', type: 'line', data: [0.2, 0.05, 0.3] }],
  xAxis: [{ type: 'value', name: 'Waypoint', min: 0, max: 2 }],
  tooltip: { trigger: 'axis' },
}

/**
 * The lazy ECharts chunk resolves and the wrapper effect runs outside act();
 * one act-flushed tick guarantees the passive effect (mount) has executed
 * before assertions.
 */
async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

// NOTE: the findByTestId('chart' / 'chart-empty') waits below pass an explicit
// 5s timeout — the lazy ECharts chunk (React.lazy + dynamic import) can exceed
// testing-library's 1000ms default while echarts transforms cold under
// full-parallel vitest load.

beforeEach(() => installCanvasMock())
afterEach(() => cleanup())

describe('EChart wrapper', () => {
  it('lazily mounts a real ECharts instance that reflects the model', async () => {
    render(<EChart model={lineModel} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()
    const chart = echarts.getInstanceByDom(el)
    expect(chart).toBeTruthy()
    expect((chart!.getOption() as { series: Array<{ data: number[] }> }).series[0].data).toEqual([
      0.2, 0.05, 0.3,
    ])
  })

  it('updates the rendered chart when the model changes', async () => {
    const { rerender } = render(<EChart model={lineModel} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()
    expect(echarts.getInstanceByDom(el)).toBeTruthy()

    rerender(
      <EChart
        model={{
          ...lineModel,
          series: [{ name: 'Manipulability', type: 'line', data: [9, 9, 9] }],
        }}
      />,
    )
    await flushEffects()
    const chart = echarts.getInstanceByDom(el)!
    expect((chart.getOption() as { series: Array<{ data: number[] }> }).series[0].data).toEqual([
      9, 9, 9,
    ])
  })

  it('mounts once and skips setOption when re-rendered with a deep-equal model (new reference)', async () => {
    const spy = vi.spyOn(adapter, 'mountChart')
    const { rerender } = render(<EChart model={lineModel} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()
    // First render always applies the model.
    expect(spy).toHaveBeenCalledTimes(1)

    // Same content, brand-new reference — the guard MUST skip the re-apply.
    rerender(<EChart model={{ ...lineModel }} />)
    await flushEffects()
    expect(spy).toHaveBeenCalledTimes(1)
    // Visible chart state is unchanged and the instance was NOT disposed.
    const chart = echarts.getInstanceByDom(el)!
    expect((chart.getOption() as { series: Array<{ data: number[] }> }).series[0].data).toEqual([
      0.2, 0.05, 0.3,
    ])
    spy.mockRestore()
  })

  it('re-applies setOption when the model content actually changes (different title)', async () => {
    const spy = vi.spyOn(adapter, 'mountChart')
    const { rerender } = render(<EChart model={lineModel} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()
    expect(spy).toHaveBeenCalledTimes(1)

    rerender(<EChart model={{ ...lineModel, title: 'Updated title' }} />)
    await flushEffects()
    expect(spy).toHaveBeenCalledTimes(2)
    const chart = echarts.getInstanceByDom(el)!
    // ECharts merges the title component into an array — read either shape.
    const title = (chart.getOption() as { title?: { text?: string } | Array<{ text?: string }> }).title
    const titleText = Array.isArray(title) ? title[0]?.text : title?.text
    expect(titleText).toBe('Updated title')
    spy.mockRestore()
  })

  it('resizes the chart when the container size changes (ResizeObserver)', async () => {
    render(<EChart model={lineModel} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()

    const spy = vi.spyOn(adapter, 'resizeChart')
    const observer = lastResizeObserverMock()
    expect(observer).not.toBeNull()
    expect(observer!.observed).toContain(el)
    observer!.fire()
    expect(spy).toHaveBeenCalledWith(el)
    spy.mockRestore()
  })

  it('disposes the ECharts instance on unmount (getInstanceByDom → undefined)', async () => {
    const { unmount } = render(<EChart model={lineModel} />)
    const el = await screen.findByTestId('chart', {}, { timeout: 5000 })
    await flushEffects()
    expect(echarts.getInstanceByDom(el)).toBeTruthy()

    unmount()
    await waitFor(() => expect(echarts.getInstanceByDom(el)).toBeUndefined())
  })

  it('renders the empty-state message instead of a chart when the model is empty', async () => {
    render(<EChart model={{ series: [], xAxis: [], empty: { message: 'No manipulability data available' } }} />)
    await flushEffects()
    const emptyEl = await screen.findByTestId('chart-empty', {}, { timeout: 5000 })
    expect(emptyEl).toHaveTextContent('No manipulability data available')
    expect(screen.queryByTestId('chart')).toBeNull()
    expect(echarts.getInstanceByDom(emptyEl)).toBeUndefined()
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
