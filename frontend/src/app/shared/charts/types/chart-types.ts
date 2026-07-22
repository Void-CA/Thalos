import type { EChartsOption } from 'echarts';

export interface ChartPoint {
  x: number;
  y: number;
  meta?: Record<string, unknown>;
}

export interface ChartSeries {
  name: string;
  data: ChartPoint[];
  color?: string;
  type?: 'line' | 'bar' | 'area';
}

export interface ChartBuilder<T> {
  build(data: T): EChartsOption;
}
