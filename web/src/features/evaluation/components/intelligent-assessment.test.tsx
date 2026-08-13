// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IntelligentAssessment } from './intelligent-assessment'
import type { AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * IntelligentAssessment — the composed view through the backward-compatible
 * wrapper. The AI verdict is the protagonist (risk word + crisp risk ·
 * quality), the analyzer health is labeled secondary, the trace audit lives in
 * the collapsible, and the assessment references footer is GONE.
 */

const assessment: AssessmentWire = {
  risk: 'high',
  quality: 0.3027,
  triggered_rules: [
    { id: 'R01_collision_danger', category: 'collision', priority: 10 },
    { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
  ],
  evidence: {
    manipulability: 0.2,
    singularity_proximity: 0.5,
    collision_clearance: -0.1,
  },
  recommendations: [],
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
      derived_output: { low_manipulability: true },
    },
  ],
}

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('IntelligentAssessment — section renders when assessment present', () => {
  it('shows the heading, the AI verdict (risk word + risk · quality) and the rules', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    expect(screen.getByRole('heading', { name: 'Intelligent Assessment' })).toBeInTheDocument()
    // AI verdict leads: risk word + crisp risk · quality (0.3027 quality → crisp 0.697).
    expect(screen.getByTestId('verdict-risk-word')).toHaveTextContent('high')
    expect(screen.getByTestId('verdict-risk-quality')).toHaveTextContent(
      'Risk 0.697 · Quality 30.3%',
    )
    // The analyzer health is secondary context (no report in store → hidden).
    expect(screen.queryByTestId('analyzer-health')).not.toBeInTheDocument()
    // Rules show human labels + real reasoning from the trace.
    const ruleRows = screen.getAllByTestId('rule-reasoning-row')
    expect(ruleRows[0]).toHaveTextContent('Collision danger')
    expect(within(ruleRows[0]).getByTestId('rule-why')).toHaveTextContent('Collision clearance is danger')
    expect(ruleRows[1]).toHaveTextContent('Low manipulability')
    expect(within(ruleRows[1]).getByTestId('rule-produced')).toHaveTextContent('marked low manipulability')
  })

  it('renders evidence rows with human label, value and semantic reading', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    const rows = screen.getAllByTestId('evidence-row')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Manipulability')
    expect(rows[0]).toHaveTextContent('0.200')
    expect(rows[0]).toHaveTextContent('Low') // < 0.3 manipulability → Low
    expect(rows[1]).toHaveTextContent('Singularity')
    expect(rows[1]).toHaveTextContent('0.500')
    expect(rows[1]).toHaveTextContent('Singular') // 0.5 = a singular event → Singular
    expect(rows[2]).toHaveTextContent('Danger') // negative clearance → Danger
  })

  it('uses English copy only (no regional variants or Spanish)', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    for (const label of ['Intelligent Assessment', 'Assessment factors', 'Inference trace']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Risk Level')).not.toBeInTheDocument()
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
  })
})
