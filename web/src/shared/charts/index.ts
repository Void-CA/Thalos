/**
 * Public exports of the chart system. Features consume charts through this
 * barrel: builders (pure), the ChartModel contract, the EChart wrapper and the
 * adapter boundary. ECharts itself is never exported from here.
 */

export * from './types'
export * from './theme'
export { manipulabilityBuilder } from './builders/manipulability'
export { metricsDashboardBuilder, scoreBreakdownBuilder } from './builders/metrics-dashboard'
export { toEChartsOption, mountChart, resizeChart, disposeChart } from './adapter'
export { EChart } from './EChart'
