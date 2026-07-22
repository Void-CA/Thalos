import { Component, computed, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../../types/chart-theme';

export interface ManipulabilityPoint {
  index: number;
  yoshikawa: number;
  severity?: 'good' | 'warning' | 'critical';
}

/**
 * Manipulability Timeline — chart interactivo con dataZoom y
 * selección de waypoints.
 *
 * No conoce AnalysisStore ni FocusService.
 * Recibe datos por input y emite eventos.
 */
@Component({
  selector: 'manipulability-timeline',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    @if (data().length === 0) {
      <div class="mt-empty">No manipulability data.</div>
    } @else {
      <div
        echarts
        [options]="chartOptions()"
        theme="dark"
        class="mt-chart"
        (chartClick)="onChartClick($event)"
      ></div>
    }
  `,
  styles: [
    `
    .mt-chart { width: 100%; height: 250px; }
    .mt-empty {
      text-align: center; color: #888; padding: 2rem;
      font-size: 0.85rem; opacity: 0.5;
    }
    `,
  ],
})
export class ManipulabilityTimeline {
  readonly data = input<ManipulabilityPoint[]>([]);
  readonly waypointClick = output<number>();

  protected readonly chartOptions = computed<EChartsOption>(() => {
    const points = this.data();
    if (points.length === 0) return {};

    const indices = points.map(p => p.index);
    const values = points.map(p => p.yoshikawa);
    const severityColors: string[] = points.map(p => {
      if (!p.severity || p.severity === 'good') return 'transparent';
      return p.severity === 'critical' ? CHART_THEME.severity.error : CHART_THEME.severity.warn;
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART_THEME.tooltip.bg,
        borderColor: CHART_THEME.tooltip.border,
        borderWidth: 1,
        textStyle: { color: CHART_THEME.tooltip.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params as { dataIndex: number; value: number };
          const point = points[p.dataIndex];
          return `<strong>Waypoint ${point.index}</strong><br/>Manipulability: ${point.yoshikawa.toFixed(4)}`;
        },
      },
      grid: { top: 24, right: 16, bottom: 40, left: 52, borderWidth: 0 },
      xAxis: {
        type: 'category',
        data: indices,
        boundaryGap: false,
        axisLine: { lineStyle: { color: CHART_THEME.grid } },
        axisLabel: { color: CHART_THEME.muted, fontSize: 10, interval: 'auto' },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: CHART_THEME.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: CHART_THEME.grid } },
      },
      // Threshold lines
      visualMap: {
        show: false,
        pieces: [
          { gt: 0.3, color: CHART_THEME.severity.success },
          { gte: 0.15, lte: 0.3, color: CHART_THEME.severity.warn },
          { lt: 0.15, color: CHART_THEME.severity.error },
        ],
        dimension: 1,
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider', start: 0, end: 100,
          bottom: 0, height: 20,
          borderColor: CHART_THEME.grid,
          textStyle: { color: CHART_THEME.muted, fontSize: 10 },
        },
      ],
      series: [
        // Markers for critical/warning points
        {
          type: 'scatter',
          data: values.map((v, i) => ({
            value: [i, v],
            itemStyle: {
              color: severityColors[i],
              opacity: severityColors[i] !== 'transparent' ? 0.8 : 0,
            },
          })),
          symbol: 'circle',
          symbolSize: 6,
        },
        // Main manipulability line
        {
          type: 'line',
          data: values,
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
          markLine: {
            silent: true,
            data: [
              { yAxis: 0.3, lineStyle: { color: CHART_THEME.severity.warn, type: 'dashed' } },
              { yAxis: 0.15, lineStyle: { color: CHART_THEME.severity.error, type: 'dashed' } },
            ],
            label: { show: false },
          },
        },
      ],
    };
  });

  protected onChartClick(event: { dataIndex?: number }): void {
    const points = this.data();
    const idx = event.dataIndex;
    if (idx != null && idx < points.length) {
      this.waypointClick.emit(points[idx].index);
    }
  }
}
