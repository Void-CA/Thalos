// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IntelligenceView } from './IntelligenceView'
import { gradeFromScore } from '@/shared/analysis/verdict'
import { useAnalysisStore } from '@/features/analysis/store'
import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * IntelligenceView — composed Intelligence tab content (structural UX
 * redesign): VerdictHero (ONE risk-tinted decision band) → FactorRows
 * (structured top factors) → Repair recommendations (action) →
 * TechnicalDetails (ONE collapsible owning rules/evidence/trace, closed by
 * default) → muted assessment references footer. All copy is English.
 */

const assessment: AssessmentWire = {
  risk: 'low',
  quality: 0.82,
  triggered_rules: [
    { id: 'R01_collision_danger', category: 'collision', priority: 10 },
    { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
    { id: 'R06_high_complexity', category: 'trajectory', priority: 1 },
  ],
  evidence: {
    manipulability: 0.75,
    singularity_proximity: 0.2,
    collision_clearance: 0.6,
    trajectory_complexity: 0.4,
  },
  recommendations: [],
  trace: [
    { rule_id: 'R01_collision_danger', priority: 10, bindings: {}, derived_output: {} },
  ],
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

const recommendationsReport: AnalysisReportWire = {
  ...report,
  recommendations: [
    {
      id: 1,
      action: {
        id: 1,
        kind: 'MoveWaypoint',
        target_observation: 3,
        priority: 'high',
        impact: 'reposition',
        parameters: {},
      },
      edit: { MoveWaypoint: { segment_index: 0, new_target: [0.5, 0, 0] } },
      status: 'available',
    },
  ],
}

beforeEach(() => {
  cleanup()
  act(() => {
    useAnalysisStore.getState().clear()
  })
})
afterEach(() => cleanup())

describe('IntelligenceView — verdict hero (v2: number + scale + inline grade)', () => {
  it('shows the canonical score + inline grade and the categorical risk in ONE hero band', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const hero = screen.getByTestId('intelligence-verdict-hero')
    expect(hero).toHaveTextContent('82') // no report → 0.82 quality → score 82
    expect(hero).toHaveTextContent('Good') // ≥70 → Good
    expect(hero).toHaveTextContent('low risk')
    // The hero is the ONLY verdict number on the tab — no competing gauge.
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Risk Level')).not.toBeInTheDocument()
    expect(screen.queryByText('Narrative Summary')).not.toBeInTheDocument()
  })

  it('maps the canonical grade bands aligned with the backend (≥90 Excellent, ≥70 Good, ≥50 Fair)', () => {
    expect(gradeFromScore(95)).toBe('Excellent')
    expect(gradeFromScore(82)).toBe('Good')
    expect(gradeFromScore(60)).toBe('Fair')
    expect(gradeFromScore(30)).toBe('Poor')
  })
})

describe('IntelligenceView — score reconciliation (P1.1 kept: hero matches Evaluation)', () => {
  it('shows the SAME canonical score as Evaluation (report.summary.score) when the report is present', () => {
    act(() => {
      useAnalysisStore.getState().setAnalysis(report)
    })
    render(
      <IntelligenceView
        assessment={{ ...assessment, quality: 0.68 }}
        regions={[]}
      />,
    )
    const hero = within(screen.getByTestId('intelligence-verdict-hero'))
    // Evaluation shows report.summary.score 72 / Good — Intelligence must too,
    // never the assessment-derived 68 (which would contradict Evaluation).
    expect(hero.getByText('72')).toBeInTheDocument()
    expect(hero.getByText('Good')).toBeInTheDocument()
    expect(hero.queryByText('68')).not.toBeInTheDocument()
    expect(hero.queryByText('Fair')).not.toBeInTheDocument()
    // The assessment's risk stays as the secondary chip.
    expect(hero.getByText('low risk')).toBeInTheDocument()
    // Report score present → no fallback note.
    expect(screen.queryByTestId('verdict-source-note')).not.toBeInTheDocument()
  })

  it('falls back to the assessment quality with a subtle note when no report score exists', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.getByTestId('verdict-source-note')).toHaveTextContent('derived from assessment quality')
  })
})

describe('IntelligenceView — factor rows "why" (structural redesign)', () => {
  it('renders one row per narrative primary factor with a human label, value and semantic reading', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const rows = screen.getAllByTestId('factor-row')
    // Top factors by risk contribution: clearance, complexity, manipulability.
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0]).toHaveTextContent('Safe clearance')
    expect(rows[0]).toHaveTextContent('0.6 m')
    expect(rows[0]).toHaveTextContent('Safe')
    // Human labels, never raw evidence keys.
    expect(screen.queryByText(/trajectory_complexity/i)).not.toBeInTheDocument()
  })
})

describe('IntelligenceView — technical details (ONE collapsible, closed by default)', () => {
  it('keeps the rules, evidence bars and trace behind a collapsed TechnicalDetails section', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const details = screen.getByTestId('technical-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const toggle = screen.getByTestId('technical-details-toggle')
    expect(toggle).toHaveTextContent('Technical details')
    expect(toggle).toHaveTextContent('3 rules')
    expect(toggle).toHaveTextContent('4 evidence')
  })

  it('expands to show the rule reasoning (human labels, category tags), the dense evidence table and the trace', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    fireEvent.click(screen.getByTestId('technical-details-toggle'))
    expect((screen.getByTestId('technical-details') as HTMLDetailsElement).open).toBe(true)

    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('3 rules')
    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Collision danger')
    // Subtle category tag per row (never the old loud badge).
    expect(rows[0]).toHaveTextContent('Collision')
    expect(rows[1]).toHaveTextContent('Manipulability')
    // The KB agenda priority must never be presented as a fuzzy weight.
    expect(screen.queryByText(/weight/i)).not.toBeInTheDocument()

    // Dense evidence table, no bars: one row per canonical variable with the
    // raw value and the tone-colored semantic reading.
    const evidenceRows = screen.getAllByTestId('evidence-row')
    expect(evidenceRows).toHaveLength(4)
    expect(evidenceRows[0]).toHaveTextContent('Manipulability')
    expect(evidenceRows[0]).toHaveTextContent('0.750')
    const readings = screen.getAllByTestId('evidence-reading')
    expect(readings[0]).toHaveTextContent('Good')
    expect(readings[1]).toHaveTextContent('Moderate')

    const traceToggle = screen.getByTestId('assessment-trace-toggle')
    expect(traceToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(traceToggle)
    expect(screen.getByTestId('assessment-trace')).toBeInTheDocument()
    const rows2 = screen.getAllByTestId('assessment-trace-entry')
    expect(rows2).toHaveLength(1)
    expect(rows2[0]).toHaveTextContent('R01_collision_danger')
  })

  it('renders the reasoning of a safe/positive rule from its trace bindings', () => {
    render(
      <IntelligenceView
        assessment={{
          ...assessment,
          triggered_rules: [{ id: 'R12_safe_plan', category: 'trajectory', priority: 1 }],
          trace: [
            {
              rule_id: 'R12_safe_plan',
              priority: 1,
              bindings: {
                safe_clearance: 'true',
                'SingularityProximity IS low': '1.000',
                'Manipulability IS high': '1.000',
              },
              derived_output: {},
            },
          ],
        }}
        regions={[]}
      />,
    )
    fireEvent.click(screen.getByTestId('technical-details-toggle'))
    const row = screen.getByTestId('rule-reasoning-row')
    expect(row).toHaveTextContent('Safe plan')
    expect(row).toHaveTextContent('Trajectory')
    // The FactEquals antecedent reads as a fact, not a raw id.
    expect(screen.getByTestId('rule-why')).toHaveTextContent('safe clearance is true')
    expect(screen.getByTestId('rule-why')).toHaveTextContent('Singularity proximity is low')
    expect(screen.getByTestId('rule-why')).toHaveTextContent('Manipulability is high')
  })
})

describe('IntelligenceView — repair recommendations action section', () => {
  it('renders the Action section with the deduped recommendation cards', () => {
    act(() => {
      useAnalysisStore.getState().setAnalysis(recommendationsReport)
    })
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.getByText('Action · Repair recommendations')).toBeInTheDocument()
    const list = screen.getByTestId('intelligence-recommendations')
    expect(within(list).getAllByTestId('recommendation-card')).toHaveLength(1)
  })
})

describe('IntelligenceView — narrative wiring (hero one-liner)', () => {
  it('shows ONE human summary line derived from the assessment + regions, never raw ids', () => {
    const region = {
      id: 1,
      kind: 'singularity',
      severity: 'critical',
      waypoint_start: 10,
      waypoint_end: 20,
      waypoint_count: 11,
      explanation: {
        cause: 'Singularity near waypoint 10',
        consequence: 'Tool flips near the goal',
        recommended_strategies: ['Joint centering'],
        confidence: 0.9,
      },
    }
    render(
      <IntelligenceView assessment={{ ...assessment, risk: 'critical' }} regions={[region]} />,
    )
    const summary = screen.getByTestId('verdict-summary')
    expect(summary).toHaveTextContent(/critically risky/i)
    expect(summary).toHaveTextContent('Singularity near waypoint 10')
    expect(summary).toHaveTextContent('waypoints 10\u201320')
    // The one-liner is human phrasing — never raw rule ids / evidence keys.
    expect(summary).not.toHaveTextContent('R0')
  })
})

describe('IntelligenceView — assessment references footer', () => {
  it('renders the muted assessment recommendation references when present', () => {
    render(
      <IntelligenceView
        assessment={{
          ...assessment,
          recommendations: [
            {
              action_kind: 'Manipulability',
              region_id: 3,
              rationale: 'Improve manipulability near the flagged region.',
            },
          ],
        }}
        regions={[]}
      />,
    )
    expect(screen.getByTestId('assessment-recommendation')).toHaveTextContent('Manipulability')
  })

  it('renders no references when the assessment carries none', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.queryByTestId('assessment-recommendation')).not.toBeInTheDocument()
    expect(screen.queryByText('Recommendations')).not.toBeInTheDocument()
  })
})
