/**
 * Analysis chart builders — score breakdown, severity distribution.
 * Migrated from shared/components/echart/chart-options.ts
 */
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../types/chart-theme';

/** Horizontal bar chart for score breakdown. */
export function scoreBreakdownChart(
  items: { name: string; value: number }[],
): EChartsOption {
  const maxVal = Math.max(...items.map(i => i.value), 1);
  return {
    backgroundColor: CHART_THEME.bg,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: CHART_THEME.tooltip.bg,
      borderColor: CHART_THEME.tooltip.border,
      borderWidth: 1,
      textStyle: { color: CHART_THEME.tooltip.text, fontSize: 12 },
    },
    grid: { top: 8, right: 40, bottom: 8, left: 90, borderWidth: 0 },
    xAxis: {
      type: 'value',
      max: maxVal * 1.15,
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_THEME.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: items.map(i => i.name),
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.text, fontSize: 11 },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: items.map(i => ({
        value: i.value,
        itemStyle: {
          color: i.value > maxVal * 0.6 ? '#4a9e5a' : i.value > maxVal * 0.3 ? '#b8943a' : '#b85450',
          borderRadius: [0, 3, 3, 0],
        },
      })),
      barWidth: 14,
      backgroundStyle: { color: '#2a2a2a', borderRadius: [0, 3, 3, 0] },
      showBackground: true,
    }],
  };
}

/** Stacked bar chart for severity distribution. */
export function severityChart(
  categories: { label: string; errors: number; warnings: number }[],
): EChartsOption {
  const labels = categories.map(c => c.label);
  return {
    backgroundColor: CHART_THEME.bg,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: CHART_THEME.tooltip.bg,
      borderColor: CHART_THEME.tooltip.border,
      borderWidth: 1,
      textStyle: { color: CHART_THEME.tooltip.text, fontSize: 12 },
    },
    legend: {
      data: ['Critical', 'Warning'],
      textStyle: { color: CHART_THEME.muted, fontSize: 10 },
      bottom: 0, left: 'center', icon: 'circle', itemWidth: 8, itemHeight: 8,
    },
    grid: { top: 8, right: 16, bottom: 32, left: 90, borderWidth: 0 },
    xAxis: {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: CHART_THEME.grid } },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_THEME.grid } },
    },
    series: [
      {
        name: 'Critical', type: 'bar', stack: 'total',
        data: categories.map(c => c.errors),
        itemStyle: { color: '#b85450' }, barWidth: 20,
      },
      {
        name: 'Warning', type: 'bar', stack: 'total',
        data: categories.map(c => c.warnings),
        itemStyle: { color: '#b8943a', borderRadius: [0, 3, 3, 0] }, barWidth: 20,
      },
    ],
  };
}
