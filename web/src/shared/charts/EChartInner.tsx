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

/**
 * Structural deep equality for ChartModel content (spec "Chart Content
 * Equality Guard"). Function references (tooltip.formatter) compare by
 * identity — two different closures may behave identically but cannot be
 * proven equal. Array order matters (positional data). Missing keys and
 * explicit `undefined` values are equivalent.
 */
export function modelsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'function' || typeof b === 'function') return false
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((value, index) => modelsEqual(value, b[index]))
  }
  const aKeys = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined)
  const bKeys = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) =>
    modelsEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

export default function EChartInner({ model, className }: EChartInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  /** The last model actually applied to the ECharts instance, or null when the
   *  instance is not mounted (initial render or after lifecycle cleanup). */
  const appliedModelRef = useRef<ChartModel | null>(null)

  // Lifecycle effect — owns the instance and the resize observer. Keyed on `[]`
  // so model updates never run its cleanup: disposing on every re-render is
  // exactly what resets ECharts hover/tooltip state. The cleanup resets
  // appliedModelRef so a React StrictMode double-invoke (effect → cleanup →
  // effect) still remounts instead of leaving a dead instance.
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const observer = new ResizeObserver(() => {
      resizeChart(el)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      appliedModelRef.current = null
      disposeChart(el)
    }
  }, [])

  // Update effect — applies the model via setOption ONLY when its content
  // actually changed. A parent re-render that passes a structurally equal
  // model (fresh reference, same content) skips the apply entirely, leaving
  // the visible chart state untouched.
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    if (appliedModelRef.current !== null && modelsEqual(appliedModelRef.current, model)) return
    appliedModelRef.current = model
    mountChart(el, model)
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
