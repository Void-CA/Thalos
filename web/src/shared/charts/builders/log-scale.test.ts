import { describe, it, expect } from 'vitest'
import { toLogScale } from './log-scale'

describe('toLogScale — singularity-safe -log10 transform for manipulability metrics', () => {
  it('maps a positive value to -log10(value)', () => {
    expect(toLogScale(1)).toBe(0)
    expect(toLogScale(0.1)).toBeCloseTo(1, 10)
    expect(toLogScale(0.001)).toBeCloseTo(3, 10)
  })

  it('grows as the value approaches zero (singularity → large)', () => {
    expect(toLogScale(0.719)).toBeCloseTo(-Math.log10(0.719), 10)
    expect(toLogScale(0.3)).toBeCloseTo(-Math.log10(0.3), 10)
    expect(toLogScale(1e-5)).toBeCloseTo(5, 10)
    expect(toLogScale(1e-9)).toBeCloseTo(9, 10)
  })

  it('maps exactly-zero values to the floor (visible singularity spike, not a dropped point)', () => {
    expect(toLogScale(0)).toBe(6)
  })

  it('applies the same floor to negative values (metrics are always >= 0)', () => {
    expect(toLogScale(-0.5)).toBe(6)
  })

  it('honours a custom floor', () => {
    expect(toLogScale(0, 8)).toBe(8)
    expect(toLogScale(-1, 8)).toBe(8)
  })
})
