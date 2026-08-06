// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import * as echarts from 'echarts/core'
import { disposeChart, mountChart, resizeChart, toEChartsOption } from './adapter'
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

describe('toEChartsOption — ChartModel → EChartsOption mapping', () => {
  it('maps series, axes, legend, tooltip and dataZoom into a complete EChartsOption', () => {
    expect(toEChartsOption(lineModel)).toEqual({
      title: {
        text: 'Manipulability',
        left: 0,
        textStyle: { color: '#888888', fontSize: 13, fontWeight: 600 },
      },
      tooltip: { trigger: 'axis', confine: true },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: '#888888', fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { top: 40, right: 16, bottom: 56, left: 16, containLabel: true },
      xAxis: [
        {
          type: 'value',
          name: 'Waypoint',
          min: 0,
          max: 2,
          axisLabel: { color: '#888888', fontSize: 11 },
          axisLine: { lineStyle: { color: '#888888' } },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          name: 'Yoshikawa',
          axisLabel: { color: '#888888', fontSize: 11 },
          splitLine: { lineStyle: { color: 'rgba(136, 136, 136, 0.25)' } },
          axisLine: { show: false },
          axisTick: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', start: 0, end: 100, bottom: 8, height: 16 },
      ],
      series: [
        {
          name: 'Manipulability',
          type: 'line',
          data: [0.2, 0.05, 0.3],
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#3b82f6', width: 2 },
          itemStyle: { color: '#3b82f6' },
        },
      ],
    })
  })

  it('defaults to a single value yAxis when the model omits it', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2] }],
      xAxis: [{ type: 'category', categories: ['a', 'b'] }],
    }
    const option = toEChartsOption(model)
    expect(option.yAxis).toEqual([
      {
        type: 'value',
        axisLabel: { color: '#888888', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(136, 136, 136, 0.25)' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ])
  })

  it('maps category axes to their category labels', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'bar', data: [3, 5, 2] }],
      xAxis: [{ type: 'category', categories: ['Error', 'Warning', 'Info'] }],
    }
    const option = toEChartsOption(model)
    expect(option.xAxis).toEqual([
      {
        type: 'category',
        data: ['Error', 'Warning', 'Info'],
        axisLabel: { color: '#888888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#888888' } },
        axisTick: { show: false },
      },
    ])
  })

  it('resolves per-point dataColors to itemStyle colors', () => {
    const model: ChartModel = {
      series: [
        {
          name: 'Observations',
          type: 'bar',
          data: [3, 5],
          dataColors: ['severity.critical', 'severity.warning'],
          color: 'chart-2',
        },
      ],
      xAxis: [{ type: 'category', categories: ['Error', 'Warning'] }],
    }
    const option = toEChartsOption(model)
    expect(option.series).toEqual([
      {
        name: 'Observations',
        type: 'bar',
        data: [
          { value: 3, itemStyle: { color: '#ee3333' } },
          { value: 5, itemStyle: { color: '#eebb22' } },
        ],
        itemStyle: { color: '#22c55e', borderRadius: [2, 2, 0, 0] },
      },
    ])
  })

  it('maps a line series areaStyle to a translucent area fill (area charts)', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2], areaStyle: true }],
      xAxis: [{ type: 'value' }],
    }
    const option = toEChartsOption(model)
    expect(option.series).toEqual([
      {
        name: 's',
        type: 'line',
        data: [1, 2],
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#3b82f6', width: 2 },
        itemStyle: { color: '#3b82f6' },
        areaStyle: { opacity: 0.12 },
      },
    ])
  })

  it('passes scale:true through to the axis (log-scale charts must not force the origin)', () => {
    const model: ChartModel = {
      series: [{ name: 's', type: 'line', data: [1, 2] }],
      xAxis: [{ type: 'value' }],
      yAxis: [{ type: 'value', name: '-log10(Yoshikawa)', scale: true }],
    }
    const option = toEChartsOption(model)
    expect(option.yAxis).toEqual([
      {
        type: 'value',
        name: '-log10(Yoshikawa)',
        scale: true,
        axisLabel: { color: '#888888', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(136, 136, 136, 0.25)' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ])
  })

  it('attaches chart-level markLine references to the first series', () => {
    const model: ChartModel = {
      series: [{ name: 'err', type: 'line', data: [1, 2, 3] }],
      xAxis: [{ type: 'value' }],
      markLine: [{ yAxis: 0.5, label: 'RMSE', color: 'severity.warning' }],
    }
    const option = toEChartsOption(model)
    const first = (option.series as Array<Record<string, unknown>>)[0]
    expect(first.markLine).toEqual({
      silent: true,
      symbol: 'none',
      lineStyle: { type: 'dashed', color: '#eebb22' },
      data: [
        {
          yAxis: 0.5,
          lineStyle: { color: '#eebb22' },
          label: { formatter: 'RMSE', color: '#888888', fontSize: 10 },
        },
      ],
    })
  })
})

describe('mount / resize / dispose lifecycle', () => {
  it('mountChart initializes a real ECharts instance; disposeChart removes it (getInstanceByDom → undefined)', () => {
    const el = document.createElement('div')
    mountChart(el, lineModel)
    expect(echarts.getInstanceByDom(el)).toBeTruthy()
    expect(disposeChart(el)).toBe(true)
    expect(echarts.getInstanceByDom(el)).toBeUndefined()
    expect(disposeChart(el)).toBe(false)
  })

  it('mountChart is idempotent: remounting reuses the same instance', () => {
    const el = document.createElement('div')
    mountChart(el, lineModel)
    const first = echarts.getInstanceByDom(el)
    mountChart(el, lineModel)
    expect(echarts.getInstanceByDom(el)).toBe(first)
    disposeChart(el)
  })

  it('resizeChart is a no-op when no instance is mounted', () => {
    const el = document.createElement('div')
    expect(() => resizeChart(el)).not.toThrow()
  })
})
