import { describe, it, expect } from 'vitest'
import { histogram } from './histogram'

describe('histogram (pure binning — workspace-analysis distribution report)', () => {
  it('returns one bin per bucket over the [min, max] range', () => {
    const result = histogram([0, 10], 5)
    expect(result).toHaveLength(5)
    expect(result[0].start).toBe(0)
    expect(result[0].end).toBe(2)
    expect(result[4].start).toBe(8)
    expect(result[4].end).toBe(10)
  })

  it('counts values in their bucket with the max clamped to the last bin', () => {
    // 0 → bin 0, 10 → clamped to bin 4, midpoints split across the rest.
    const result = histogram([0, 1, 3, 5, 7, 9, 10], 5)
    expect(result.map((b) => b.count)).toEqual([2, 1, 1, 1, 2])
  })

  it('collapses all-equal values into bin 0 (range normalized to 1)', () => {
    const result = histogram([5, 5, 5, 5], 4)
    expect(result[0].count).toBe(4)
    expect(result.slice(1).every((b) => b.count === 0)).toBe(true)
    // Degenerate range still yields a positive width (no NaN edges).
    expect(result[3].end - result[0].start).toBeGreaterThan(0)
  })

  it('returns [] for empty input', () => {
    expect(histogram([], 10)).toEqual([])
  })

  it('ignores non-finite values', () => {
    const result = histogram([0, NaN, Infinity, -Infinity, 1], 2)
    expect(result[0].count).toBe(1)
    expect(result[1].count).toBe(1)
  })

  it('throws when bins is not positive', () => {
    expect(() => histogram([1, 2], 0)).toThrow()
    expect(() => histogram([1, 2], -3)).toThrow()
  })

  it('keeps bin ranges contiguous (end of bin i === start of bin i+1)', () => {
    const result = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].end).toBe(result[i + 1].start)
    }
  })
})
