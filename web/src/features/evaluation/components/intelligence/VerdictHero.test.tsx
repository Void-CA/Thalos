// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { VerdictHero } from './VerdictHero'
import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * VerdictHero (structural UX redesign) — the decision band: canonical score +
 * grade pill + risk badge + ONE human summary line. Pins:
 * - the primary number is `report.summary.score` with the backend-aligned
 *   grade (`gradeFromScore`) — the SAME score the Evaluation tab shows;
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

describe('VerdictHero — the decision band (structural redesign)', () => {
  it('shows the canonical report score, grade, risk badge and the human summary line', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    const hero = screen.getByTestId('intelligence-verdict-hero')
    expect(screen.getByTestId('verdict-score')).toHaveTextContent('72')
    expect(screen.getByText('/ 100')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-grade')).toHaveTextContent('Good')
    expect(screen.getByTestId('verdict-risk')).toHaveTextContent('medium')
    expect(screen.getByTestId('verdict-summary')).toHaveTextContent(summary)
    expect(hero).toHaveTextContent('Score')
    expect(hero).toHaveTextContent('Risk Level')
    // No fallback note when the report carries a score.
    expect(screen.queryByTestId('verdict-source-note')).not.toBeInTheDocument()
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
})
