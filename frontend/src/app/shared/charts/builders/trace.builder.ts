/**
 * Trace chart builder — joint positions/velocities over time.
 * Para el Session Browser trace preview.
 */
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../types/chart-theme';

export interface TraceData {
  samples: Array<{ timestamp: number; joints: number[]; velocities?: number[] }>;
  jointCount: number;
}

export function jointPositionsChart(data: TraceData): EChartsOption {
  if (data.samples.length === 0 || data.jointCount === 0) return {};

  const duration = data.samples[data.samples.length - 1].timestamp;

  return {
    backgroundColor: CHART_THEME.bg,
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART_THEME.tooltip.bg,
      borderColor: CHART_THEME.tooltip.border,
      borderWidth: 1,
      textStyle: { color: CHART_THEME.tooltip.text, fontSize: 11 },
    },
    legend: {
      data: Array.from({ length: data.jointCount }, (_, i) => `J${i + 1}`),
      textStyle: { color: CHART_THEME.muted, fontSize: 10 },
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
    },
    grid: { top: 16, right: 16, bottom: 36, left: 48, borderWidth: 0 },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: CHART_THEME.grid } },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10, formatter: '{value}s' },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_THEME.grid } },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
    ],
    series: Array.from({ length: data.jointCount }, (_, j) => ({
      name: `J${j + 1}`,
      type: 'line' as const,
      data: data.samples.map(s => [s.timestamp, s.joints[j] ?? 0]),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: CHART_THEME.series[j % CHART_THEME.series.length], width: 1.5 },
    })),
  };
}

export function jointVelocitiesChart(data: TraceData): EChartsOption {
  if (data.samples.length === 0 || data.jointCount === 0) return {};
  if (!data.samples[0].velocities) return {};

  return {
    backgroundColor: CHART_THEME.bg,
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART_THEME.tooltip.bg,
      borderColor: CHART_THEME.tooltip.border,
      borderWidth: 1,
      textStyle: { color: CHART_THEME.tooltip.text, fontSize: 11 },
    },
    legend: {
      data: Array.from({ length: data.jointCount }, (_, i) => `J${i + 1}`),
      textStyle: { color: CHART_THEME.muted, fontSize: 10 },
      bottom: 0,
      icon: 'circle',
      itemWidth: 8, itemHeight: 8,
    },
    grid: { top: 16, right: 16, bottom: 36, left: 48, borderWidth: 0 },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: CHART_THEME.grid } },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_THEME.grid } },
    },
    series: Array.from({ length: data.jointCount }, (_, j) => ({
      name: `J${j + 1}`,
      type: 'line' as const,
      data: data.samples.map(s => [s.timestamp, s.velocities![j] ?? 0]),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: CHART_THEME.series[j % CHART_THEME.series.length], width: 1.5 },
    })),
  };
}
