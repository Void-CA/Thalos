/**
 * Chart option builders para ECharts.
 *
 * Todos usan el theme 'dark' con colores consistentes con Thalos.
 * Los colores de la paleta:
 *   - error:  #b85450
 *   - warn:   #b8943a
 *   - info:   #4a7a9a
 *   - accent: #4a8ab5
 *   - success:#4a9e5a
 *   - surface:#1e1e1e
 */

import type { EChartsOption } from 'echarts';

const BG = '#1e1e1e';
const TEXT = '#c0c0c0';
const MUTED = '#888';
const GRID_COLOR = '#333';

/** Base grid config for all charts. */
function baseGrid(top = 30, right = 16, bottom = 24, left = 48): EChartsOption['grid'] {
  return {
    top, right, bottom, left,
    containLabel: false,
    borderWidth: 0,
  };
}

/** Base xAxis config. */
function baseXAxis(data?: string[]): EChartsOption['xAxis'] {
  return {
    type: data ? 'category' : 'value',
    data,
    axisLine: { lineStyle: { color: GRID_COLOR } },
    axisLabel: { color: MUTED, fontSize: 10 },
    splitLine: { show: false },
    axisTick: { show: false },
  };
}

/** Base yAxis config. */
function baseYAxis(): EChartsOption['yAxis'] {
  return {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: MUTED, fontSize: 10 },
    splitLine: { lineStyle: { color: GRID_COLOR } },
    axisTick: { show: false },
  };
}

/**
 * Horizontal bar chart para score breakdown.
 * Muestra cada métrica como una barra horizontal con color según valor.
 */
export function scoreBreakdownChart(items: { name: string; value: number }[]): EChartsOption {
  const maxVal = Math.max(...items.map(i => i.value), 1);
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#252525',
      borderColor: '#444',
      borderWidth: 1,
      textStyle: { color: TEXT, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params as { name: string; value: number };
        return `${p.name}: <strong>${p.value.toFixed(3)}</strong>`;
      },
    },
    grid: baseGrid(8, 40, 8, 90),
    xAxis: {
      type: 'value',
      max: maxVal * 1.15,
      axisLine: { show: false },
      axisLabel: { color: MUTED, fontSize: 10 },
      splitLine: { lineStyle: { color: GRID_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: items.map(i => i.name),
      axisLine: { show: false },
      axisLabel: { color: TEXT, fontSize: 11 },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: items.map(i => ({
        value: i.value,
        itemStyle: {
          color: i.value > maxVal * 0.6 ? '#4a9e5a'
               : i.value > maxVal * 0.3 ? '#b8943a'
               : '#b85450',
          borderRadius: [0, 3, 3, 0],
        },
      })),
      barWidth: 14,
      backgroundStyle: { color: '#2a2a2a', borderRadius: [0, 3, 3, 0] },
      showBackground: true,
    }],
  };
}

/**
 * Stacked bar chart para severity distribution (error/warning/info).
 */
export function severityChart(
  categories: { label: string; errors: number; warnings: number; total: number }[],
): EChartsOption {
  const labels = categories.map(c => c.label);
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#252525',
      borderColor: '#444',
      borderWidth: 1,
      textStyle: { color: TEXT, fontSize: 12 },
    },
    legend: {
      data: ['Critical', 'Warning'],
      textStyle: { color: MUTED, fontSize: 10 },
      bottom: 0,
      left: 'center',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
    },
    grid: baseGrid(8, 16, 32, 90),
    xAxis: baseXAxis(labels),
    yAxis: baseYAxis(),
    series: [
      {
        name: 'Critical',
        type: 'bar',
        stack: 'total',
        data: categories.map(c => c.errors),
        itemStyle: { color: '#b85450', borderRadius: [0, 0, 0, 0] },
        barWidth: 20,
      },
      {
        name: 'Warning',
        type: 'bar',
        stack: 'total',
        data: categories.map(c => c.warnings),
        itemStyle: { color: '#b8943a', borderRadius: [0, 3, 3, 0] },
        barWidth: 20,
      },
    ],
  };
}

/**
 * Línea simple para manipulability over waypoints.
 */
export function lineChart(
  data: { x: number; y: number }[],
  label: string,
  color = '#4a8ab5',
): EChartsOption {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#252525',
      borderColor: '#444',
      borderWidth: 1,
      textStyle: { color: TEXT, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params as { axisValue: number; value: number };
        return `${label}: <strong>${p.value.toFixed(4)}</strong>`;
      },
    },
    grid: baseGrid(16, 16, 24, 48),
    xAxis: {
      ...baseXAxis(),
      axisLabel: { color: MUTED, fontSize: 10 },
    },
    yAxis: {
      ...baseYAxis(),
      axisLabel: { color: MUTED, fontSize: 10 },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 0, height: 16, borderColor: GRID_COLOR },
    ],
    series: [{
      type: 'line',
      data: data.map(d => d.y),
      smooth: true,
      symbol: 'none',
      lineStyle: { color, width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + '40' }, { offset: 1, color: color + '05' }] } },
    }],
  };
}
