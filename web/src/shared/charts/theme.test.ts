/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveChartColor, withAlpha, CHART_PALETTE } from './theme'

describe('theme color resolution', () => {
  it('resolves severity token references from shared/tokens.ts constants', () => {
    expect(resolveChartColor('severity.critical')).toBe('#ee3333')
    expect(resolveChartColor('severity.good')).toBe('#44cc44')
    expect(resolveChartColor('severity.nodata')).toBe('#888888')
  })

  it('resolves manipulability and singularity token references', () => {
    expect(resolveChartColor('manip.high')).toBe('#44cc44')
    expect(resolveChartColor('manip.low')).toBe('#ee3333')
    expect(resolveChartColor('singular.near')).toBe('#eebb22')
  })

  it('resolves chart-1..4 palette references (fallback path: no CSS var engine in node)', () => {
    expect(resolveChartColor('chart-1')).toBe('#3b82f6')
    expect(CHART_PALETTE).toEqual(['chart-1', 'chart-2', 'chart-3', 'chart-4'])
    expect(resolveChartColor('chart-2')).toBe('#22c55e')
  })

  it('falls back to the first palette color for unknown references instead of crashing', () => {
    expect(resolveChartColor('does-not-exist')).toBe('#3b82f6')
  })
})

describe('theme source hygiene (spec negative scenario)', () => {
  const source = readFileSync(new URL('./theme.ts', import.meta.url), 'utf8')

  it('contains no hardcoded hex color literals', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('withAlpha', () => {
  it('turns a #rrggbb color into an rgba() string', () => {
    expect(withAlpha('#44cc44', 0.25)).toBe('rgba(68, 204, 68, 0.25)')
  })

  it('parses rgb() and rgba() input without NaN', () => {
    expect(withAlpha('rgb(59, 130, 246)', 0.95)).toBe('rgba(59, 130, 246, 0.95)')
    expect(withAlpha('rgba(59, 130, 246, 0.5)', 0.95)).toBe('rgba(59, 130, 246, 0.95)')
  })

  it('converts oklch() (the computed value of --chart-1) into a valid rgba string', () => {
    // Regression (spec "Tooltip Legibility Styling"): cssVarComputed reads
    // --chart-1 which is defined as oklch() in index.css; withAlpha used to
    // parse it as hex and produce rgba(NaN, NaN, NaN, 0.95) — an invalid color
    // that left the tooltip panel invisible in real browsers.
    const result = withAlpha('oklch(0.54 0.15 280)', 0.95)
    expect(result).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.95\)$/)
    expect(result).not.toContain('NaN')
  })

  it('returns the input unchanged when the color cannot be parsed', () => {
    expect(withAlpha('transparent', 0.5)).toBe('transparent')
  })
})
