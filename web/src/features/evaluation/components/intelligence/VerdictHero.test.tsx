// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { VerdictHero } from './VerdictHero'
import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * VerdictHero (UX redesign v2: number + scale + inline grade) — the decision
 * band: the big score with the grade word INLINE as one statement, anchored on
 * a 0–100 score scale, risk as a small secondary chip, ONE human summary line.
 * Pins:
 * - the primary number is `report.summary.score` with the backend-aligned
 *   grade (`gradeFromScore`) — the SAME score the Evaluation tab shows;
 * - the grade renders INLINE with the number (baseline statement, no pill);
 * - the score scale fill width reflects the score (position anchored);
 * - risk renders as a secondary chip WITHOUT a "Risk Level" label;
 * - the uppercase "Score" label is gone — the hierarchy carries the meaning;
 * - fallback to `verdictFromQuality(assessment.quality)` only when the report
 *   has no score, flagged with the subtle `verdict-source-note`;
 * - the whole band is tinted by the risk tier;
 * - `assessment-verdict` testid contract kept for existing suites.
 */

const assessment: AssessmentWire = {
  risk: 'medium',
  quality: 0.68,
  triggered_rules: [],
  evidence: {},
  recommendations: [],
  trace: [],
}

const report: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [],
  actions: [],
  metrics: {},
  summary: {
    quality_index: 0.72,
    score: 72,
    grade: 'Good',
    observation_count: 0,
    severity_distribution: {},
  },
}

const summary = 'The plan is moderately risky: trajectory complexity is very high.'

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('VerdictHero — the decision band (v2: number + scale + inline grade)', () => {
  it('shows the canonical report score, inline grade, risk chip and the human summary line', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    const hero = screen.getByTestId('intelligence-verdict-hero')
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('72')
    expect(screen.getByText('/ 100')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-grade')).toHaveTextContent('Good')
    expect(screen.getByTestId('verdict-risk')).toHaveTextContent('medium risk')
    expect(screen.getByTestId('verdict-summary')).toHaveTextContent(summary)
    // No uppercase labels — the statement carries the hierarchy.
    expect(hero).not.toHaveTextContent('Score')
    expect(hero).not.toHaveTextContent('Risk Level')
    // No fallback note when the report carries a score.
    expect(screen.queryByTestId('verdict-source-note')).not.toBeInTheDocument()
  })

  it('renders the grade word INLINE with the number (baseline statement, not a floating pill)', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    const score = screen.getByTestId('verdict-score')
    const grade = screen.getByTestId('verdict-grade')
    // Both live in the same baseline-aligned statement container.
    expect(score.closest('span')?.parentElement).toBe(grade.closest('span')?.parentElement)
    // Grade is colored text — no pill chrome (no background class).
    expect(grade.className).toMatch(/text-chart-3/)
    expect(grade.className).not.toMatch(/bg-/)
  })

  it('anchors the score on a 0–100 scale (fill width reflects the score)', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    expect(screen.getByTestId('verdict-scale')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-scale-fill')).toHaveStyle({ width: '72%' })
  })

  it('renders risk as a small secondary chip without a Risk Level label', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    const chip = screen.getByTestId('verdict-risk')
    expect(chip).toHaveTextContent('medium risk')
    expect(screen.queryByText('Risk Level')).not.toBeInTheDocument()
  })

  it('falls back to the assessment-quality score with a subtle note when the report has no score', () => {
    render(<VerdictHero assessment={assessment} report={null} summary={summary} />)
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('68')
    expect(screen.getByTestId('verdict-grade')).toHaveTextContent('Fair') // 68 → Fair
    expect(screen.getByTestId('verdict-source-note')).toHaveTextContent(
      'derived from assessment quality',
    )
  })

  it('tints the whole band by the risk tier (critical → destructive, low → success, high → warning)', () => {
    const { rerender } = render(
      <VerdictHero assessment={{ ...assessment, risk: 'critical' }} report={report} summary={summary} />,
    )
    expect(screen.getByTestId('intelligence-verdict-hero').className).toContain('destructive')

    rerender(<VerdictHero assessment={{ ...assessment, risk: 'low' }} report={report} summary={summary} />)
    expect(screen.getByTestId('intelligence-verdict-hero').className).toContain('success')

    rerender(<VerdictHero assessment={{ ...assessment, risk: 'high' }} report={report} summary={summary} />)
    expect(screen.getByTestId('intelligence-verdict-hero').className).toContain('warning')
  })

  it('keeps the legacy assessment-verdict testid contract', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    expect(screen.getByTestId('assessment-verdict')).toBeInTheDocument()
  })

  it('projects the dual-component quality_index onto the 0–100 score (M4 composite score)', () => {
    // The primary number IS the dual-component quality_index projected × 100
    // by the backend DTO (quality_index 0.70 → score 70) — the M1 semantics
    // surface in the UI as the dominant statement, not the saturated legacy
    // severity count.
    render(
      <VerdictHero
        assessment={assessment}
        report={{
          ...report,
          summary: {
            ...report.summary,
            quality_index: 0.7,
            score: 70,
            grade: 'Good',
          },
        }}
        summary={summary}
      />,
    )
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('70')
    expect(screen.getByTestId('verdict-grade')).toHaveTextContent('Good')
    expect(screen.getByTestId('verdict-scale-fill')).toHaveStyle({ width: '70%' })
  })
})
