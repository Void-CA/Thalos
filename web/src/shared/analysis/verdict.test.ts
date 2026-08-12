import { describe, it, expect } from 'vitest'
import { gradeFromScore, scoreFromQuality, verdictFromQuality } from './verdict'

/**
 * Canonical verdict view model — pins the score→grade mapping to the backend
 * semantics (thalos-core `analysis/scoring.rs` `grade_for` projected to the
 * score scale): Excellent ≥ 90, Good ≥ 70, Fair ≥ 50, else Poor, with
 * INCLUSIVE lower bounds exactly like the backend's `>=` thresholds.
 */

describe('gradeFromScore — backend-aligned boundaries', () => {
  it('is Excellent at and above 90 (mirrors quality_index ≥ 0.9)', () => {
    expect(gradeFromScore(100)).toBe('Excellent')
    expect(gradeFromScore(95)).toBe('Excellent')
    expect(gradeFromScore(90)).toBe('Excellent')
  })

  it('is Good from 70 up to 89 (mirrors quality_index ≥ 0.7)', () => {
    expect(gradeFromScore(89)).toBe('Good')
    expect(gradeFromScore(80)).toBe('Good')
    expect(gradeFromScore(70)).toBe('Good')
  })

  it('is Fair from 50 up to 69 (mirrors quality_index ≥ 0.5)', () => {
    expect(gradeFromScore(69)).toBe('Fair')
    expect(gradeFromScore(60)).toBe('Fair')
    expect(gradeFromScore(50)).toBe('Fair')
  })

  it('is Poor strictly below 50 (mirrors quality_index < 0.5)', () => {
    expect(gradeFromScore(49)).toBe('Poor')
    expect(gradeFromScore(30)).toBe('Poor')
    expect(gradeFromScore(0)).toBe('Poor')
  })

  it('aligns with the backend test fixtures 0.95/0.75/0.55/0.30 → Excellent/Good/Fair/Poor', () => {
    // Thalos-core scoring.rs `grade_boundaries_map_to_grades`.
    expect(gradeFromScore(95)).toBe('Excellent')
    expect(gradeFromScore(75)).toBe('Good')
    expect(gradeFromScore(55)).toBe('Fair')
    expect(gradeFromScore(30)).toBe('Poor')
  })
})

describe('scoreFromQuality — same projection as the backend DTO', () => {
  it('scales 0..1 quality onto 0–100', () => {
    expect(scoreFromQuality(1)).toBe(100)
    expect(scoreFromQuality(0.82)).toBe(82)
    expect(scoreFromQuality(0.5)).toBe(50)
    expect(scoreFromQuality(0.3)).toBe(30)
    expect(scoreFromQuality(0)).toBe(0)
  })

  it('rounds like the backend (round(quality × 100))', () => {
    expect(scoreFromQuality(0.995)).toBe(100)
    expect(scoreFromQuality(0.3027)).toBe(30)
  })

  it('clamps out-of-range values', () => {
    expect(scoreFromQuality(1.5)).toBe(100)
    expect(scoreFromQuality(-0.2)).toBe(0)
  })
})

describe('verdictFromQuality — one canonical pair from the wire quality', () => {
  it('derives score AND grade together', () => {
    const verdict = verdictFromQuality(0.82)
    expect(verdict.score).toBe(82)
    expect(verdict.grade).toBe('Good')
  })

  it('keeps grade consistent with gradeFromScore(score)', () => {
    for (const quality of [0.95, 0.75, 0.5, 0.31, 0.05]) {
      const verdict = verdictFromQuality(quality)
      expect(verdict.grade).toBe(gradeFromScore(verdict.score))
    }
  })
})
