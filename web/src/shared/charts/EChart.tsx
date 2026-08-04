/**
 * EChart — lazy React wrapper (design P6, spec chart-system-react).
 *
 * The heavy ECharts module is loaded on first chart render via React.lazy +
 * dynamic import, keeping ECharts out of the initial bundle. The wrapper knows
 * nothing about domain data and nothing about ECharts: it receives a ChartModel
 * and delegates all library interaction to the adapter.
 */

import { lazy, Suspense } from 'react'
import type { ChartModel } from './types'

const EChartInner = lazy(() => import('./EChartInner'))

export interface EChartProps {
  model: ChartModel
  className?: string
}

export function EChart({ model, className }: EChartProps) {
  return (
    <Suspense fallback={<div className={className} data-testid="chart-loading" />}>
      <EChartInner model={model} className={className} />
    </Suspense>
  )
}
