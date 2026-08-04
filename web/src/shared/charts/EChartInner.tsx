/**
 * EChartInner — the concrete chart component behind the lazy `EChart` facade
 * (design P6). Responsibilities: mount the chart via the adapter, observe the
 * container with ResizeObserver and resize, dispose on unmount. It has no
 * domain knowledge and never imports ECharts directly — every library call goes
 * through `adapter.ts` (the single ECharts frontier, O3).
 */

import { useEffect, useRef } from 'react'
import type { ChartModel } from './types'
import { disposeChart, mountChart, resizeChart } from './adapter'

export interface EChartInnerProps {
  model: ChartModel
  className?: string
}

export default function EChartInner({ model, className }: EChartInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    mountChart(el, model)
    const observer = new ResizeObserver(() => {
      resizeChart(el)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      disposeChart(el)
    }
  }, [model])

  if (model.empty !== undefined) {
    return (
      <div data-testid="chart-empty" className={className}>
        {model.empty.message}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="chart"
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 160 }}
    />
  )
}
