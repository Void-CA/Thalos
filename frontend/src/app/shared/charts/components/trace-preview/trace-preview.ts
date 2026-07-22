import { Component, computed, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../../types/chart-theme';

export interface TraceSample {
  timestamp: number;
  joints: number[];
  velocities?: number[];
}

/**
 * Trace preview — joint positions over time from execution data.
 * No conoce SessionApiService. Recibe datos por input.
 */
@Component({
  selector: 'trace-preview',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    @if (samples().length === 0) {
      <div class="tp-empty">No trace data.</div>
    } @else {
      <div echarts [options]="chartOptions()" theme="dark" class="tp-chart"></div>
    }
  `,
  styles: [`
    .tp-chart { width: 100%; height: 220px; }
    .tp-empty { text-align: center; color: #888; padding: 1.5rem; font-size: 0.85rem; opacity: 0.5; }
  `],
})
export class TracePreview {
  readonly samples = input<TraceSample[]>([]);
  readonly jointCount = input(0);

  protected readonly chartOptions = computed<EChartsOption>(() => {
    const samples = this.samples();
    const jc = this.jointCount() || (samples[0]?.joints.length ?? 0);
    if (samples.length === 0 || jc === 0) return {};

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART_THEME.tooltip.bg,
        borderColor: CHART_THEME.tooltip.border,
        borderWidth: 1,
        textStyle: { color: CHART_THEME.tooltip.text, fontSize: 11 },
      },
      legend: {
        data: Array.from({ length: jc }, (_, i) => `J${i + 1}`),
        textStyle: { color: CHART_THEME.muted, fontSize: 10 },
        bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8,
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
      series: Array.from({ length: jc }, (_, j) => ({
        name: `J${j + 1}`,
        type: 'line' as const,
        data: samples.map(s => [s.timestamp, s.joints[j] ?? 0]),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: CHART_THEME.series[j % CHART_THEME.series.length], width: 1.5 },
      })),
    };
  });
}
