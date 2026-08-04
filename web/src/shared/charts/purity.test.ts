/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Purity boundary tests (O2/O3): builders, types and theme must be free of any
 * ECharts or React dependency; the adapter is the single module allowed to
 * import ECharts. Enforced statically so a stray import fails the suite.
 */

const PURE_MODULES = [
  new URL('./types.ts', import.meta.url),
  new URL('./theme.ts', import.meta.url),
  new URL('./builders/manipulability.ts', import.meta.url),
  new URL('./builders/metrics-dashboard.ts', import.meta.url),
]

const BOUNDARY_MODULES = [new URL('./adapter.ts', import.meta.url)]

/** Source without comments — the purity contract is about code, not docs. */
function codeOf(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('builder purity (O2: AnalysisReport → Builder → ChartModel)', () => {
  it.each(PURE_MODULES)('module %s imports neither echarts nor react', (url) => {
    const source = codeOf(url)
    expect(source).not.toMatch(/from\s+['"]echarts/)
    expect(source).not.toMatch(/from\s+['"]react/)
    expect(source).not.toMatch(/\bEChartsOption\b/)
  })

  it('builders never mention the ECharts API surface', () => {
    for (const url of [
      new URL('./builders/manipulability.ts', import.meta.url),
      new URL('./builders/metrics-dashboard.ts', import.meta.url),
    ]) {
      const source = codeOf(url)
      expect(source).not.toMatch(/echarts/i)
      expect(source).not.toMatch(/\boption\b/i)
    }
  })
})

describe('adapter boundary (O3: single ECharts frontier)', () => {
  it.each(BOUNDARY_MODULES)('adapter imports echarts and never react', (url) => {
    const source = codeOf(url)
    expect(source).toMatch(/from\s+['"]echarts/)
    expect(source).not.toMatch(/from\s+['"]react/)
  })

  it('feature chart components never import echarts (S3: PlanCharts stays a consumer)', () => {
    const source = codeOf(
      new URL('../../features/planning/components/PlanCharts.tsx', import.meta.url),
    )
    expect(source).not.toMatch(/from\s+['"]echarts/)
    expect(source).not.toMatch(/\becharts\./i)
  })
})
