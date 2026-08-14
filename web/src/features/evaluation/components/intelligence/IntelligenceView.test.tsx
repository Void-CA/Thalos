// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IntelligenceView } from './IntelligenceView'
import { useAnalysisStore } from '@/features/analysis/store'
import type { AnalysisReportWire, AssessmentWire, CandidateRankingWire } from '@/shared/contracts/analysis-report'

/**
 * IntelligenceView — composed Intelligence tab content. The AI verdict is the
 * protagonist (risk word + crisp risk · quality), the analyzer health is
 * clearly-labeled secondary, the elevation story (why) explains the verdict,
 * and the inference trace is ALWAYS visible (no collapsible — the Advisor now
 * lives in its own Repairs tab). All copy is English.
 */

const assessment: AssessmentWire = {
  risk: 'low',
  quality: 0.82,
  triggered_rules: [
    { id: 'R01_collision_danger', category: 'collision', priority: 10 },
    { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
  ],
  evidence: {
    manipulability: 0.75,
    singularity_proximity: 0.2,
    collision_clearance: 0.6,
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

describe('IntelligenceView — verdict hero (v3: the AI verdict is the protagonist)', () => {
  it('leads with the assessor risk word + crisp risk · quality, and shows analyzer health as labeled secondary', () => {
    act(() => {
      useAnalysisStore.getState().setAnalysis(report)
    })
    render(<IntelligenceView assessment={{ ...assessment, quality: 0.68 }} regions={[]} />)
    const hero = screen.getByTestId('intelligence-verdict-hero')
    // AI verdict leads: risk word + Risk/Quality derived from the assessor.
    expect(within(hero).getByTestId('verdict-risk-word')).toHaveTextContent('low')
    expect(within(hero).getByTestId('verdict-risk-quality')).toHaveTextContent(
      'Risk 0.320 · Quality 68.0%',
    )
    // The analyzer score is NOT the primary verdict.
    expect(within(hero).queryByTestId('verdict-score')).not.toBeInTheDocument()
    // Analyzer health is clearly-labeled secondary context.
    const health = within(hero).getByTestId('analyzer-health')
    expect(health).toHaveTextContent('Analyzer health: 72')
    expect(health).toHaveTextContent('strict fault-penalty score')
    // No competing gauge / score labels.
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Risk Level')).not.toBeInTheDocument()
  })

  it('renders the elevation story (why line) and the Why block when a singular event is present', () => {
    render(
      <IntelligenceView
        assessment={{
          ...assessment,
          risk: 'high',
          quality: 0.44,
          evidence: { ...assessment.evidence, singularity_proximity: 0.5 },
          trace: [
            { rule_id: 'R09_near_singularity', priority: 3, bindings: {}, derived_output: {} },
          ],
        }}
        regions={[]}
      />,
    )
    // Hero: the why line tells the story without opening anything.
    expect(screen.getByTestId('verdict-why')).toHaveTextContent(
      'Singular event detected → risk elevated to High',
    )
    // The Why block names the mechanism.
    const whyBlock = screen.getByTestId('intelligence-why')
    expect(whyBlock).toHaveTextContent('Why High?')
    expect(whyBlock).toHaveTextContent('R09_near_singularity classified the evidence as high risk.')
  })

  it('renders no Why block when no singular event is present', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.queryByTestId('intelligence-why')).not.toBeInTheDocument()
    expect(screen.queryByTestId('verdict-why')).not.toBeInTheDocument()
  })
})

describe('IntelligenceView — factor rows (scannable table)', () => {
  it('renders one row per factor with a human label, value and semantic reading', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const rows = screen.getAllByTestId('factor-row')
    // Ranked by risk contribution: clearance(0.4), manipulability(0.25), singularity(0.2).
    expect(rows[0]).toHaveTextContent('Safe clearance')
    expect(rows[0]).toHaveTextContent('0.6 m')
    expect(rows[0]).toHaveTextContent('Safe')
    // Human labels, never raw evidence keys.
    expect(screen.queryByText(/singularity_proximity/i)).not.toBeInTheDocument()
  })
})

describe('IntelligenceView — inference trace (ALWAYS visible, no collapsible)', () => {
  it('renders the rules and evidence in an open section labeled Inference trace', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const section = screen.getByTestId('technical-details')
    expect(section.tagName).toBe('SECTION')
    expect(section).toHaveTextContent('Inference trace')
    expect(section).toHaveTextContent('2 rules')
    expect(section).toHaveTextContent('3 evidence')
  })

  it('shows the rule reasoning and the dense evidence table without any click', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Collision danger')
    expect(within(rows[0]).getByTestId('rule-priority')).toHaveTextContent('10')

    const evidenceRows = screen.getAllByTestId('evidence-row')
    expect(evidenceRows).toHaveLength(3)
    expect(evidenceRows[0]).toHaveTextContent('Manipulability')
    expect(evidenceRows[0]).toHaveTextContent('0.750')
    const readings = screen.getAllByTestId('evidence-reading')
    expect(readings[0]).toHaveTextContent('Good')
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

describe('IntelligenceView — assessment references footer is GONE', () => {
  it('never renders the assessment references list (it duplicated the advisor)', () => {
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
    expect(screen.queryByTestId('assessment-recommendation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('assessment-recommendations')).not.toBeInTheDocument()
  })
})

describe('IntelligenceView — Candidate Alternatives mount (spec evaluation-intelligence-tab)', () => {
  /** A minimal candidate ranking — shape only; the section is wire-driven. */
  const ranking: CandidateRankingWire = {
    ranked: [
      { strategy: 'Direct', risk: 0.4, duration: 10, manipulability: 0.3, length: 5, cost: 1 },
      { strategy: 'AlternateElbow', risk: 0.2, duration: 6, manipulability: 0.6, length: 3, cost: 0 },
    ],
    selected: 'AlternateElbow',
    reason: {
      kind: 'selected',
      strategy: 'AlternateElbow',
      metric_comparison: [{ component: 'risk', selected_value: 0.2, baseline_value: 0.4 }],
      endpoints: 'Endpoints: preserved',
      task: 'Task: preserved',
    },
    strategy_trace: [
      { strategy: 'Direct', outcome: { kind: 'generated' } },
      { strategy: 'InsertWaypoint', outcome: { kind: 'skipped', reason: 'UnsupportedSegment' } },
      { strategy: 'AlternateElbow', outcome: { kind: 'generated' } },
    ],
  }

  function reportWithRanking(): AnalysisReportWire {
    return {
      ...report,
      candidate_ranking: ranking,
    }
  }

  it('mounts the Candidate Alternatives section below the existing content when candidate_ranking is present', () => {
    act(() => {
      useAnalysisStore.getState().setAnalysis(reportWithRanking())
    })
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const section = screen.getByTestId('candidate-alternatives')
    expect(section).toBeInTheDocument()
    // Section order: the assessment content first (detail trace), the
    // alternatives section AFTER it (layered below, never replacing).
    const technical = screen.getByTestId('technical-details')
    expect(technical.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The existing Assessor representation is unchanged.
    expect(screen.getByTestId('intelligent-assessment')).toBeInTheDocument()
    expect(screen.getByTestId('intelligence-verdict-hero')).toBeInTheDocument()
  })

  it('does NOT mount the section when candidate_ranking is absent (sections 0–5 unchanged)', () => {
    act(() => {
      useAnalysisStore.getState().setAnalysis(report)
    })
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.queryByTestId('candidate-alternatives')).not.toBeInTheDocument()
    // Sections 0–5 still render exactly as before.
    expect(screen.getByTestId('intelligent-assessment')).toBeInTheDocument()
    expect(screen.getByTestId('intelligence-verdict-hero')).toBeInTheDocument()
    expect(screen.getByTestId('intelligence-factor-rows')).toBeInTheDocument()
    expect(screen.getByTestId('technical-details')).toBeInTheDocument()
  })
})
