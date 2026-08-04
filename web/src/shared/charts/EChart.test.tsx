// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import '@testing-library/jest-dom/vitest'
import * as echarts from 'echarts/core'
import { EChart } from './EChart'
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
