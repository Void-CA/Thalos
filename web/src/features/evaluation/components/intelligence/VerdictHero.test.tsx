// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { VerdictHero } from './VerdictHero'
import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * VerdictHero (v3 — the AI verdict is the protagonist). Pins:
 * - the primary statement is the ASSESSOR's categorical risk word + the crisp
 *   risk · quality line (`quality = 1 − crisp risk`), NEVER the analyzer score;
 * - the ANALYZER's health (`report.summary.score` + grade) is clearly-labeled
 *   SECONDARY context (provenance explicit), never competing visually;
 * - the `whyLine` (elevation story) renders immediately below when provided;
 * - the human narrative summary renders as secondary detail;
 * - the whole band is tinted by the risk tier.
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

const summary = 'The plan is moderately risky.'

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('VerdictHero — the AI verdict is the protagonist', () => {
  it('leads with the categorical risk word and the crisp risk · quality, NOT the analyzer score', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    // Primary: the risk word + risk/quality derived from the assessor.
    expect(screen.getByTestId('verdict-risk-word')).toHaveTextContent('medium')
    expect(screen.getByTestId('verdict-risk-quality')).toHaveTextContent('Risk 0.320 · Quality 68.0%')
    // The analyzer score must NOT be the hero's primary statement.
    expect(screen.queryByTestId('verdict-score')).not.toBeInTheDocument()
    expect(screen.queryByTestId('verdict-grade')).not.toBeInTheDocument()
  })

  it('shows the analyzer health as clearly-labeled secondary context when the report has a score', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    const health = screen.getByTestId('analyzer-health')
    expect(health).toHaveTextContent('Analyzer health: 72')
    expect(health).toHaveTextContent('Good')
    expect(health).toHaveTextContent('strict fault-penalty score')
  })

  it('hides the analyzer health when the report carries no score', () => {
    render(<VerdictHero assessment={assessment} report={null} summary={summary} />)
    expect(screen.queryByTestId('analyzer-health')).not.toBeInTheDocument()
    // The AI verdict still renders.
    expect(screen.getByTestId('verdict-risk-word')).toHaveTextContent('medium')
  })

  it('renders the why line (elevation story) when provided', () => {
    render(
      <VerdictHero
        assessment={{ ...assessment, risk: 'high' }}
        report={report}
        summary={summary}
        whyLine="Singular event detected → risk elevated to High"
      />,
    )
    expect(screen.getByTestId('verdict-why')).toHaveTextContent(
      'Singular event detected → risk elevated to High',
    )
  })

  it('renders the human summary line', () => {
    render(<VerdictHero assessment={assessment} report={report} summary={summary} />)
    expect(screen.getByTestId('verdict-summary')).toHaveTextContent(summary)
  })

  it('tints the whole band by the risk tier (critical → destructive, low → success, high → warning)', () => {
    const { rerender } = render(
      <VerdictHero
        assessment={{ ...assessment, risk: 'critical' }}
        report={report}
        summary={summary}
      />,
    )
    expect(screen.getByTestId('intelligence-verdict-hero').className).toContain('destructive')

    rerender(<VerdictHero assessment={{ ...assessment, risk: 'low' }} report={report} summary={summary} />)
    expect(screen.getByTestId('intelligence-verdict-hero').className).toContain('success')

    rerender(<VerdictHero assessment={{ ...assessment, risk: 'high' }} report={report} summary={summary} />)
    expect(screen.getByTestId('intelligence-verdict-hero').className).toContain('warning')
  })
})
