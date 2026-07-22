import { Component, computed, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { CHART_THEME } from '../../types/chart-theme';

export interface ComparisonInput {
  rmse: number;
  maxError: number;
  alignedCount: number;
  pairedErrors?: number[];
}

/**
 * Comparison chart — plan vs execution tracking error.
 */
@Component({
  selector: 'comparison-chart',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    @if (!data()) {
      <div class="cc-empty">No comparison data.</div>
    } @else {
      <div class="cc-metrics">
        <div class="cc-metric">
          <span class="cc-metric-val">{{ data()!.rmse.toFixed(4) }}</span>
          <span class="cc-metric-lbl">RMSE</span>
        </div>
        <div class="cc-metric">
          <span class="cc-metric-val">{{ data()!.maxError.toFixed(4) }}</span>
          <span class="cc-metric-lbl">Max Error</span>
        </div>
        <div class="cc-metric">
          <span class="cc-metric-val">{{ data()!.alignedCount }}</span>
          <span class="cc-metric-lbl">Aligned</span>
        </div>
      </div>
      @if ((data()!.pairedErrors?.length ?? 0) > 0) {
        <div echarts [options]="chartOptions()" theme="dark" class="cc-chart"></div>
      }
    }
  `,
  styles: [`
    .cc-empty { text-align: center; color: #888; padding: 1.5rem; font-size: 0.85rem; opacity: 0.5; }
    .cc-metrics { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
    .cc-metric { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 0.4rem; background: #252525; border: 1px solid #333; border-radius: 4px; }
    .cc-metric-val { font-size: 1rem; font-weight: 700; font-variant-numeric: tabular-nums; color: #c0c0c0; }
    .cc-metric-lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; color: #888; opacity: 0.6; }
    .cc-chart { width: 100%; height: 180px; }
  `],
})
export class ComparisonChart {
  readonly data = input<ComparisonInput | null>(null);

  protected readonly chartOptions = computed<EChartsOption>(() => {
    const d = this.data();
    if (!d?.pairedErrors?.length) return {};

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART_THEME.tooltip.bg,
        borderColor: CHART_THEME.tooltip.border,
        borderWidth: 1,
        textStyle: { color: CHART_THEME.tooltip.text, fontSize: 11 },
      },
      grid: { top: 8, right: 16, bottom: 20, left: 48, borderWidth: 0 },
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
      series: [{
        type: 'line',
        data: d.pairedErrors,
        smooth: false,
        symbol: 'none',
        lineStyle: { color: CHART_THEME.severity.error, width: 1.5 },
        areaStyle: { color: CHART_THEME.severity.error + '20' },
        markLine: {
          silent: true,
          data: [{ yAxis: d.rmse, lineStyle: { color: CHART_THEME.severity.warn, type: 'dashed' } }],
          label: { formatter: `RMSE: ${d.rmse.toFixed(4)}`, color: CHART_THEME.muted, fontSize: 10 },
        },
      }],
    };
  });
}
