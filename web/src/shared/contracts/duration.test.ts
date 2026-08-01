import { describe, expect, it } from 'vitest'
import { DurationDto, type DurationDto as DurationDtoShape } from '@/shared/contracts'

describe('DurationDto.fromSeconds', () => {
  it('serializes 1.5s to {secs: 1, nanos: 500_000_000}', () => {
    expect(DurationDto.fromSeconds(1.5)).toEqual({ secs: 1, nanos: 500_000_000 })
  })

  it('serializes 0s to {secs: 0, nanos: 0}', () => {
    expect(DurationDto.fromSeconds(0)).toEqual({ secs: 0, nanos: 0 })
  })

  it('serializes an integer number of seconds with zero nanos', () => {
    expect(DurationDto.fromSeconds(3)).toEqual({ secs: 3, nanos: 0 })
  })

  it('rounds sub-nanosecond fractions away (1.5000000004s)', () => {
    expect(DurationDto.fromSeconds(1.5000000004)).toEqual({ secs: 1, nanos: 500_000_000 })
  })

  it('carries a rounded nanos >= 1e9 into secs (1.9999999996s)', () => {
    expect(DurationDto.fromSeconds(1.9999999996)).toEqual({ secs: 2, nanos: 0 })
  })

  it('rejects negative durations with a RangeError', () => {
    expect(() => DurationDto.fromSeconds(-1)).toThrow(RangeError)
    expect(() => DurationDto.fromSeconds(-0.5)).toThrow(RangeError)
  })

  it('always emits an integer nanos in [0, 1e9)', () => {
    for (const seconds of [0.001, 1.5, 2.25, 10.999999999]) {
      const d: DurationDtoShape = DurationDto.fromSeconds(seconds)
      expect(Number.isInteger(d.secs)).toBe(true)
      expect(Number.isInteger(d.nanos)).toBe(true)
      expect(d.nanos).toBeGreaterThanOrEqual(0)
      expect(d.nanos).toBeLessThan(1_000_000_000)
    }
  })
})

describe('DurationDto wire shape', () => {
  it('round-trips through {secs, nanos} JSON', () => {
    const d: DurationDtoShape = DurationDto.fromSeconds(1.5)
    expect(JSON.stringify(d)).toBe('{"secs":1,"nanos":500000000}')
    expect(JSON.parse(JSON.stringify(d))).toEqual({ secs: 1, nanos: 500_000_000 })
  })
})
