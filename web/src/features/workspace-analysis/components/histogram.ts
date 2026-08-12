/**
 * Histogram binning — pure function (workspace-analysis distribution report).
 *
 * Derives the "where do the samples land" answer from data ALREADY in the
 * workspace store: no backend changes, no new data. Pure and DOM-free so it is
 * trivially unit-testable (histogram.test.ts).
 */

export interface HistogramBin {
  /** 0-based bin index. */
  bin: number
  /** Lower bound of the bin's value range (inclusive). */
  start: number
  /** Upper bound of the bin's value range (exclusive, except the last bin). */
  end: number
  /** Number of values that fell into the bin. */
  count: number
}

/**
 * Bin `values` into `bins` equal-width buckets over [min, max].
 *
 * - Empty / non-finite input → `[]` (the caller renders nothing).
 * - All-equal values collapse into bin 0 (range normalized to 1 so the
 *   width stays positive).
 * - The maximum value clamps into the last bin (no off-by-one).
 */
export function histogram(values: number[], bins = 10): HistogramBin[] {
  if (bins <= 0) {
    throw new Error('histogram: bins must be positive')
  }
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return []

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const width = max === min ? 1 : (max - min) / bins

  const result: HistogramBin[] = Array.from({ length: bins }, (_, bin) => ({
    bin,
    start: min + bin * width,
    end: min + (bin + 1) * width,
    count: 0,
  }))

  for (const value of finite) {
    const index = Math.min(bins - 1, Math.floor((value - min) / width))
    result[index].count += 1
  }
  return result
}
