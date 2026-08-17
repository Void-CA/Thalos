/**
 * Public exports of the chart system. Features consume charts through this
 * barrel: builders (pure), the ChartModel contract and the lazy EChart wrapper.
 *
 * The adapter is deliberately NOT exported here (C2 remediation): it imports
 * ECharts statically, and re-exporting it from the barrel made ECharts
 * reachable from the eager feature graph (PlanCharts, session tabs), pulling
 * the library into the initial bundle. The adapter is reachable ONLY through
 * the lazy `EChartInner` chunk (`import('./EChartInner')`) or by direct module
 * path (`shared/charts/adapter`). Builders and EChart stay barrel-safe.
 */

export * from './types'
export * from './theme'
export * from './trajectory3d'
export { manipulabilityBuilder } from './builders/manipulability'
export { determinantBuilder } from './builders/determinant'
export { metricsDashboardBuilder, scoreBreakdownBuilder } from './builders/metrics-dashboard'
export { comparisonBuilder } from './builders/comparison'
export { timelineBuilder } from './builders/timeline'
export { traceBuilder } from './builders/trace'
export { EChart } from './EChart'
