/**
 * Manipulability chart builder — waypoint index vs manipulability value.
 * Incluye dataZoom slider para inspeccionar rangos de waypoints.
 */
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../types/chart-theme';

export interface ManipulabilityData {
  waypoints: Array<{ index: number; yoshikawa: number }>;
}

export function manipulabilityChart(data: ManipulabilityData): EChartsOption {
  const items = data.waypoints;
  if (items.length === 0) return {};

  return {
    backgroundColor: CHART_THEME.bg,
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART_THEME.tooltip.bg,
      borderColor: CHART_THEME.tooltip.border,
      borderWidth: 1,
      textStyle: { color: CHART_THEME.tooltip.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params as { dataIndex: number; value: number };
        const wp = items[p.dataIndex];
        return `<strong>wp${wp.index}</strong>: ${wp.yoshikawa.toFixed(4)}`;
      },
    },
    grid: { top: 16, right: 16, bottom: 40, left: 48, borderWidth: 0 },
    xAxis: {
      type: 'value',
      min: items[0].index,
      max: items[items.length - 1].index,
      axisLine: { lineStyle: { color: CHART_THEME.grid } },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_THEME.grid } },
      axisTick: { show: false },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, bottom: 0, height: 16, borderColor: CHART_THEME.grid },
    ],
    series: [{
      type: 'line',
      data: items.map(wp => wp.yoshikawa),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: CHART_THEME.series[0], width: 2 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: CHART_THEME.series[0] + '40' },
            { offset: 1, color: CHART_THEME.series[0] + '05' },
          ],
        },
      },
    }],
  };
}
