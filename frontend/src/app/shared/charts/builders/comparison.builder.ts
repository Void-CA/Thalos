/**
 * Comparison chart — plan vs execution joint error.
 */
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../types/chart-theme';

export interface ComparisonData {
  pairedErrors: number[];
  rmse: number;
  maxError: number;
}

export function comparisonErrorChart(data: ComparisonData): EChartsOption {
  const errors = data.pairedErrors;
  if (errors.length === 0) return {};

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART_THEME.tooltip.bg,
      borderColor: CHART_THEME.tooltip.border,
      borderWidth: 1,
      textStyle: { color: CHART_THEME.tooltip.text, fontSize: 11 },
    },
    grid: { top: 16, right: 16, bottom: 24, left: 48, borderWidth: 0 },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: CHART_THEME.grid } },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10, formatter: '{value} rad' },
      splitLine: { lineStyle: { color: CHART_THEME.grid } },
    },
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
    series: [{
      type: 'line',
      data: errors,
      smooth: false,
      symbol: 'none',
      lineStyle: { color: CHART_THEME.severity.error, width: 1.5 },
      areaStyle: { color: CHART_THEME.severity.error + '20' },
      markLine: {
        silent: true,
        data: [
          { yAxis: data.rmse, lineStyle: { color: CHART_THEME.severity.warn, type: 'dashed' } },
        ],
        label: { formatter: `RMSE: ${data.rmse.toFixed(4)}`, color: CHART_THEME.muted, fontSize: 10 },
      },
    }],
  };
}
