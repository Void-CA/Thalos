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

/** `#rrggbb` → `[r, g, b]`; rgb()/rgba() strings parsed directly. */
function parseRgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

/** `oklch(L C H)` → sRGB `[r, g, b]` (OKLab → linear sRGB → sRGB, D65). */
function parseOklch(color: string): [number, number, number] | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(color)
  if (!match) return null
  const L = Number(match[1])
  const C = Number(match[2])
  const H = (Number(match[3]) * Math.PI) / 180
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** Any CSS color → `rgba(r, g, b, alpha)` (derived — no hardcoded color). */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseRgb(color) ?? parseOklch(color)
  if (rgb === null) return color
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}
