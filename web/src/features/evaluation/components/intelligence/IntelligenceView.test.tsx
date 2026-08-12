// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IntelligenceView } from './IntelligenceView'
import { gradeFromScore } from '@/shared/analysis/verdict'
import { useAnalysisStore } from '@/features/analysis/store'
import type { AnalysisReportWire, AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * IntelligenceView — composed Intelligence tab content (spec
 * evaluation-intelligence-tab): Verdict gauge → Triggered rules (grouped by
 * category, human labels) → Evidence bars (semantic readings) → collapsible
 * Detail trace, all English copy.
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

beforeEach(() => {
  cleanup()
  act(() => {
    useAnalysisStore.getState().clear()
  })
})
afterEach(() => cleanup())

describe('IntelligenceView — verdict gauge (spec scenario)', () => {
  it('shows the canonical score + grade and the categorical risk', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const verdict = within(screen.getByTestId('assessment-verdict'))
    expect(verdict.getByText('Score')).toBeInTheDocument()
    expect(verdict.getByText('82')).toBeInTheDocument() // no report → 0.82 quality → score 82
    expect(verdict.getByText('Good')).toBeInTheDocument() // ≥70 → Good
    expect(verdict.getByText('Risk Level')).toBeInTheDocument()
    expect(verdict.getByText('low')).toBeInTheDocument()
  })

  it('maps the canonical grade bands aligned with the backend (≥90 Excellent, ≥70 Good, ≥50 Fair)', () => {
    expect(gradeFromScore(95)).toBe('Excellent')
    expect(gradeFromScore(82)).toBe('Good')
    expect(gradeFromScore(60)).toBe('Fair')
    expect(gradeFromScore(30)).toBe('Poor')
  })
})

describe('IntelligenceView — score reconciliation (UX redesign: "which is which?")', () => {
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
    const verdict = within(screen.getByTestId('assessment-verdict'))
    // Evaluation shows report.summary.score 72 / Good — Intelligence must too,
    // never the assessment-derived 68 (which would contradict Evaluation).
    expect(verdict.getByText('72')).toBeInTheDocument()
    expect(verdict.getByText('Good')).toBeInTheDocument()
    expect(verdict.queryByText('68')).not.toBeInTheDocument()
    expect(verdict.queryByText('Fair')).not.toBeInTheDocument()
    // The assessment's risk stays as the secondary badge.
    expect(verdict.getByText('low')).toBeInTheDocument()
    // Report score present → no fallback note.
    expect(screen.queryByTestId('verdict-source-note')).not.toBeInTheDocument()
  })

  it('falls back to the assessment quality with a subtle note when no report score exists', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.getByTestId('verdict-source-note')).toHaveTextContent('derived from assessment quality')
  })
})

describe('IntelligenceView — triggered rules "why" (UX redesign)', () => {
  it('groups rules by category and labels them humanly', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('3 rules')

    const groups = screen.getAllByTestId('assessment-rule-group')
    expect(groups).toHaveLength(3) // collision, manipulability, trajectory
    expect(groups[0]).toHaveTextContent('Collision')
    expect(groups[1]).toHaveTextContent('Manipulability')
    expect(groups[2]).toHaveTextContent('Trajectory')

    const chips = screen.getAllByTestId('assessment-rule')
    expect(chips).toHaveLength(3)
    // Human labels, never raw rule ids.
    expect(chips[0]).toHaveTextContent('Collision danger')
    expect(chips[0]).toHaveTextContent('priority 10')
    // The KB agenda priority must never be presented as a fuzzy weight.
    expect(screen.queryByText(/weight/i)).not.toBeInTheDocument()
    // The raw rule id stays only as the traceability anchor.
    expect(chips[0]).toHaveAttribute('title', 'R01_collision_danger')
  })

  it('renders safe/positive rules with a distinct (non-warning) chip', () => {
    render(
      <IntelligenceView
        assessment={{
          ...assessment,
          triggered_rules: [{ id: 'R12_safe_plan', category: 'trajectory', priority: 1 }],
        }}
        regions={[]}
      />,
    )
    const chip = screen.getByTestId('assessment-rule')
    expect(chip).toHaveTextContent('Safe plan')
    expect(chip.className).toContain('success')
  })
})

describe('IntelligenceView — membership bars "evidence" (UX redesign)', () => {
  it('shows one bar per canonical variable with human label, value and semantic reading', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const chips = screen.getAllByTestId('assessment-evidence-chip')
    expect(chips).toHaveLength(4)
    expect(chips[0]).toHaveTextContent('Manipulability')
    expect(chips[0]).toHaveTextContent('0.750')
    // Semantic readings derived from the KB-anchored thresholds.
    const readings = screen.getAllByTestId('evidence-reading')
    expect(readings[0]).toHaveTextContent('Good') // 0.75 manipulability
    expect(readings[1]).toHaveTextContent('Moderate') // 0.2 singularity proximity

    const bars = screen.getAllByTestId('membership-bar')
    expect(bars).toHaveLength(4)
    expect(bars[0]).toHaveStyle({ width: '75%' }) // 0.75 → 75%
    expect(bars[1]).toHaveStyle({ width: '20%' }) // 0.2 → 20%
    expect(bars[3]).toHaveStyle({ width: '40%' }) // 0.4 → 40%
  })
})

describe('IntelligenceView — detail trace (spec scenario)', () => {
  it('expands the collapsible trace on demand, collapsed by default', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const toggle = screen.getByTestId('assessment-trace-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('assessment-trace')).not.toBeInTheDocument()
    // The collapsed state still names the trace (not hidden).
    expect(toggle).toHaveTextContent('Inference trace')

    fireEvent.click(toggle)
    expect(screen.getByTestId('assessment-trace')).toBeInTheDocument()
    const rows = screen.getAllByTestId('assessment-trace-entry')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('R01_collision_danger')
  })
})

describe('IntelligenceView — narrative summary wiring (intelligible-repair-loop 2.3)', () => {
  it('renders the NarrativeSummaryCard with the assessment and the passed regions', () => {
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
    render(<IntelligenceView assessment={{ ...assessment, risk: 'critical' }} regions={[region]} />)
    const narrative = screen.getByTestId('narrative-summary')
    expect(narrative).toHaveTextContent(/critical risk plan/i)
    expect(narrative).toHaveTextContent('Singularity near waypoint 10')
  })

  it('shows the narrative but no repair-context line when the assessment references no recommendations', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.getByTestId('narrative-summary')).toBeInTheDocument()
    // No recommendations referenced by the assessment → no repair context line.
    expect(screen.queryByText(/repair recommendation/i)).not.toBeInTheDocument()
  })
})
