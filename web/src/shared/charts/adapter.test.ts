// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { prepareChart, TOOLTIP_PANEL } from './adapter'
import type { ChartModel } from './types'
import { installCanvasMock } from '@/test/canvas-mock'

beforeEach(() => installCanvasMock())

const lineModel: ChartModel = {
  title: 'Manipulability',
  series: [
    {
      name: 'Manipulability',
      type: 'line',
      data: [0.2, 0.05, 0.3],
      color: 'chart-1',
      smooth: true,
    },
  ],
  xAxis: [{ type: 'value', name: 'Waypoint', min: 0, max: 2 }],
  yAxis: [{ type: 'value', name: 'Yoshikawa' }],
  legend: { show: true, position: 'bottom' },
  dataZoom: [
    { type: 'inside', start: 0, end: 100 },
    { type: 'slider', start: 0, end: 100 },
  ],
  tooltip: { trigger: 'axis' },
}

describe('prepareChart — ChartModel → Recharts dataset + series config', () => {
  it('maps every series to a named dataKey and resolves the color token', () => {
    const prepared = prepareChart(lineModel)
    expect(prepared.series).toEqual([
      {
        name: 'Manipulability',
        type: 'line',
        dataKey: '__s0',
        color: expect.stringMatching(/^#|^rgba?\(/),
        hideSymbol: false,
        areaStyle: false,
      },
    ])
  })

  it('projects value-x data onto rows with a numeric __x and per-series cells', () => {
    const model: ChartModel = {
      series: [
        { name: 'a', type: 'line', data: [[0, 10], [1, 20]] },
        { name: 'b', type: 'line', data: [5, 7] },
      ],
      xAxis: [{ type: 'value' }],
    }
    const prepared = prepareChart(model)
    // x from the explicit [x, y] pairs of the first series; b is index-projected.
    expect(prepared.rows).toEqual([
      { __x: 0, __s0: 10, __s1: 5 },
      { __x: 1, __s0: 20, __s1: 7 },
    ])
  })

  it('projects category-x data onto rows carrying the label on __xLabel', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'bar', data: [3, 5, 2] }],
      xAxis: [{ type: 'category', categories: ['Error', 'Warning', 'Info'] }],
    }
    const prepared = prepareChart(model)
    expect(prepared.xAxis).toEqual(model.xAxis?.[0])
    expect(prepared.rows).toEqual([
      { __xLabel: 'Error', __s0: 3 },
      { __xLabel: 'Warning', __s0: 5 },
      { __xLabel: 'Info', __s0: 2 },
    ])
  })

  it('pads shorter series with null cells and sizes rows to the longest series', () => {
    const model: ChartModel = {
      series: [
        { name: 'a', type: 'line', data: [1, 2, 3] },
        { name: 'b', type: 'line', data: [9] },
      ],
      xAxis: [{ type: 'value' }],
    }
    const prepared = prepareChart(model)
    expect(prepared.rows).toEqual([
      { __x: 0, __s0: 1, __s1: 9 },
      { __x: 1, __s0: 2, __s1: null },
      { __x: 2, __s0: 3, __s1: null },
    ])
  })

  it('defaults to a single value yAxis when the model omits it', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2] }],
      xAxis: [{ type: 'category', categories: ['a', 'b'] }],
    }
    const prepared = prepareChart(model)
    expect(prepared.yAxis).toEqual([{ type: 'value' }])
  })

  it('passes legend / tooltip / markLine through and coercs a bare dataZoom to an array', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2] }],
      xAxis: [{ type: 'value' }],
      legend: { show: true, position: 'top' },
      dataZoom: { type: 'slider', start: 10, end: 90 },
      tooltip: { trigger: 'axis' },
      markLine: [{ yAxis: 0.5, label: 'RMSE' }],
    }
    const prepared = prepareChart(model)
    expect(prepared.legend).toEqual(model.legend)
    expect(prepared.tooltip).toEqual(model.tooltip)
    expect(prepared.markLine).toEqual(model.markLine)
    expect(prepared.dataZoom).toEqual([{ type: 'slider', start: 10, end: 90 }])
  })

  it('omits legend/dataZoom/tooltip/markLine keys when the model does not set them', () => {
    const prepared = prepareChart({ series: [{ name: 's', type: 'line', data: [1] }], xAxis: [{ type: 'value' }] })
    expect('legend' in prepared).toBe(false)
    expect('dataZoom' in prepared).toBe(false)
    expect('tooltip' in prepared).toBe(false)
    expect('markLine' in prepared).toBe(false)
  })
})

describe('tooltip styling — semantic tokens only (spec "Tooltip Legibility Styling")', () => {
  it('derives the panel background/border from theme tokens as rgba(), never raw hex', () => {
    expect(TOOLTIP_PANEL.backgroundColor).toMatch(/^rgba\(/i)
    expect(TOOLTIP_PANEL.borderColor).toMatch(/^rgba\(/i)
    expect(JSON.stringify(TOOLTIP_PANEL)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})