import { describe, it, expect } from 'vitest'
import { scaleFromRefDim } from './scale'

/**
 * scaleFromRefDim — the shared pure helper for reference-dimension scaling
 * (spec scene-viewport-entities "Overlay Sizes Scale with referenceDimension").
 *
 * The helper OWNS the fallback: components never inline their own
 * `refDim ?? 1.0` — they call `scaleFromRefDim(refDim, baseRatio)` and the
 * absent-referenceDimension case degrades to `1.0 × baseRatio`, which
 * preserves every current hardcoded size (backward compatibility, no-op at
 * refDim = 1.0).
 */

describe('scaleFromRefDim — proportional overlay scaling', () => {
  it('scales the base ratio by the reference dimension (0.2 × 0.4 → 0.08)', () => {
    expect(scaleFromRefDim(0.2, 0.4)).toBeCloseTo(0.08, 10)
  })

  it('falls back to 1.0 when referenceDimension is undefined or null', () => {
    expect(scaleFromRefDim(undefined, 0.4)).toBeCloseTo(0.4, 10)
    expect(scaleFromRefDim(null, 0.4)).toBeCloseTo(0.4, 10)
  })

  it('is a no-op at referenceDimension 1.0 (returns baseRatio unchanged)', () => {
    expect(scaleFromRefDim(1.0, 0.4)).toBeCloseTo(0.4, 10)
    expect(scaleFromRefDim(1.0, 0.08)).toBeCloseTo(0.08, 10)
  })
})
