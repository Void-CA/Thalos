/**
 * Chart theme — resolves ChartModel color token references to concrete colors.
 *
 * Source of truth is shared/tokens.ts (severity / manipulability / singularity
 * constants) plus the `--chart-1..4` CSS custom properties defined in
 * index.css. This module contains NO hardcoded hex literals (spec
 * chart-system-react negative scenario): every concrete color derives from a
 * token constant or a computed CSS custom property.
 */

import {
  MANIP_HIGH,
  MANIP_LOW,
  MANIP_MED,
  SEVERITY,
  SINGULAR_NEAR,
  SINGULAR_NORMAL,
  SINGULAR_SINGULAR,
  SEGMENT_PALETTE,
} from '@/shared/tokens'

/** Default series palette — theme-key references, cycled by the adapter. */
export const CHART_PALETTE = ['chart-1', 'chart-2', 'chart-3', 'chart-4'] as const

/** Numeric token (0xrrggbb) → CSS color string. */
function toCssColor(value: number): string {
  return '#' + value.toString(16).padStart(6, '0')
}

/** Token references → concrete colors. The ONLY place hex exists is tokens.ts. */
const TOKEN_COLORS: Record<string, string> = {
  'severity.good': toCssColor(SEVERITY.good),
  'severity.warning': toCssColor(SEVERITY.warning),
  'severity.critical': toCssColor(SEVERITY.critical),
  'severity.nodata': toCssColor(SEVERITY.nodata),
  'manip.high': toCssColor(MANIP_HIGH),
  'manip.med': toCssColor(MANIP_MED),
  'manip.low': toCssColor(MANIP_LOW),
  'singular.normal': toCssColor(SINGULAR_NORMAL),
  'singular.near': toCssColor(SINGULAR_NEAR),
  'singular.singular': toCssColor(SINGULAR_SINGULAR),
  'chart-1': toCssColor(SEGMENT_PALETTE[0]),
  'chart-2': toCssColor(SEGMENT_PALETTE[1]),
  'chart-3': toCssColor(SEGMENT_PALETTE[2]),
  'chart-4': toCssColor(SEGMENT_PALETTE[3]),
}

/**
 * Reads a CSS custom property through a probe element so the returned value is
 * COMPUTED (e.g. `oklch(...)` → `rgb(...)`, safe for canvas). Returns null in
 * test environments (node/jsdom have no var() engine).
 */
function cssVarComputed(name: string): string | null {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return null
  const probe = document.createElement('div')
  probe.style.color = `var(--${name})`
  probe.style.position = 'absolute'
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  if (
    !computed ||
    computed === 'transparent' ||
    computed.includes('var(') ||
    /^rgba\(0,\s*0,\s*0,\s*0\)$/.test(computed)
  ) {
    return null
  }
  return computed
}

/** Resolves a ChartModel color token reference to a concrete CSS color. */
export function resolveChartColor(ref: string): string {
  if (ref.startsWith('chart-')) {
    const cssVar = cssVarComputed(ref)
    if (cssVar) return cssVar
  }
  return TOKEN_COLORS[ref] ?? TOKEN_COLORS['chart-1']
}

/** Palette color for the n-th series, cycling through `CHART_PALETTE`. */
export function paletteColor(index: number): string {
  return resolveChartColor(CHART_PALETTE[index % CHART_PALETTE.length])
}

/** `#rrggbb` → `rgba(r, g, b, alpha)` (derived — no hardcoded color). */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
