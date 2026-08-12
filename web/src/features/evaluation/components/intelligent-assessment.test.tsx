// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IntelligentAssessment } from './intelligent-assessment'
import type { AssessmentWire } from '@/shared/contracts/analysis-report'

const assessment: AssessmentWire = {
  risk: 'high',
  quality: 0.3027,
  triggered_rules: [
    { id: 'R01_collision_danger', category: 'collision', priority: 10 },
    { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
  ],
  evidence: {
    manipulability: 0.2,
    singularity_proximity: 0.3,
    collision_clearance: -0.1,
  },
  recommendations: [
    {
      action_kind: 'Collision',
      region_id: 2,
      rationale: 'The intelligent assessment flags collision risk in this region.',
    },
  ],
  trace: [
    {
      rule_id: 'R01_collision_danger',
      priority: 10,
      bindings: { 'CollisionClearance IS danger': '1.000' },
      derived_output: {},
    },
    {
      rule_id: 'R07_low_manipulability',
      priority: 3,
      bindings: { 'Manipulability IS low': '0.667' },
      derived_output: { danger_zone: true },
    },
  ],
}

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('IntelligentAssessment — section renders when assessment present', () => {
  it('shows the heading, risk chip, canonical score, rules and recommendations', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    expect(screen.getByRole('heading', { name: 'Intelligent Assessment' })).toBeInTheDocument()
    expect(screen.getByText('high risk')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument() // 0.3027 quality → score 30
    expect(screen.getByText('Poor')).toBeInTheDocument() // <50 → Poor
    expect(screen.getByText('Triggered Rules')).toBeInTheDocument()
    // UX redesign: rules show human labels + the real reasoning from the trace
    // (why it fired / what it produced), not bare chips.
    const ruleRows = screen.getAllByTestId('rule-reasoning-row')
    expect(ruleRows[0]).toHaveTextContent('Collision danger')
    expect(within(ruleRows[0]).getByTestId('rule-why')).toHaveTextContent('Collision clearance is danger')
    expect(ruleRows[1]).toHaveTextContent('Low manipulability')
    expect(within(ruleRows[1]).getByTestId('rule-produced')).toHaveTextContent('marked danger zone')
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    // The category reads as a subtle per-row tag, not a grouped chip header.
    expect(within(ruleRows[0]).getByText('Collision')).toBeInTheDocument()
  })

  it('renders evidence rows with human label, value and semantic reading', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    const rows = screen.getAllByTestId('evidence-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Manipulability')
    expect(rows[0]).toHaveTextContent('0.200')
    expect(rows[0]).toHaveTextContent('Low') // < 0.3 manipulability → Low
    expect(rows[1]).toHaveTextContent('Singularity proximity')
    expect(rows[1]).toHaveTextContent('0.300')
    expect(rows[1]).toHaveTextContent('Near') // ≥ 0.3 proximity → Near
  })

  it('uses English copy only (no regional variants or Spanish)', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    for (const label of [
      'Intelligent Assessment',
      'high risk',
      'Triggered Rules',
      'Evidence',
      'Recommendations',
    ]) {
      // "Evidence" appears twice once expanded (heading + table column header).
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // v2: no uppercase "Score"/"Risk Level" labels — the hierarchy carries it.
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Risk Level')).not.toBeInTheDocument()
    // The inference trace table was merged into the rules table — its copy is gone.
    expect(screen.queryByText(/Inference trace/i)).not.toBeInTheDocument()
    for (const banned of ['Riesgo', 'Calidad', 'Traza', 'Evaluación']) {
      expect(screen.queryByText(banned)).not.toBeInTheDocument()
    }
  })

  it('shows the agenda priority merged from the trace into the rule reasoning rows', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByTestId('rule-priority')).toHaveTextContent('10')
    expect(within(rows[1]).getByTestId('rule-priority')).toHaveTextContent('3')
    // No redundant trace table remains.
    expect(screen.queryByTestId('assessment-trace-toggle')).not.toBeInTheDocument()
  })

  it('renders no recommendation rows when the assessment carries none', () => {
    render(<IntelligentAssessment assessment={{ ...assessment, recommendations: [] }} />)
    expect(screen.queryByTestId('assessment-recommendation')).not.toBeInTheDocument()
    expect(screen.queryByText('Recommendations')).not.toBeInTheDocument()
  })
})

describe('IntelligentAssessment — risk badge', () => {
  it('renders the categorical risk value on the chip', () => {
    const { unmount } = render(<IntelligentAssessment assessment={assessment} />)
    expect(within(screen.getByTestId('intelligent-assessment')).getByText('high risk')).toBeInTheDocument()
    unmount()

    render(<IntelligentAssessment assessment={{ ...assessment, risk: 'critical' }} />)
    expect(within(screen.getByTestId('intelligent-assessment')).getByText('critical risk')).toBeInTheDocument()
  })
})
