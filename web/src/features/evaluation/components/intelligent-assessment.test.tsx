// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
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
  it('shows the heading, risk level, canonical score, rules and recommendations', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    expect(screen.getByRole('heading', { name: 'Intelligent Assessment' })).toBeInTheDocument()
    expect(screen.getByText('Risk Level')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument() // 0.3027 quality → score 30
    expect(screen.getByText('Poor')).toBeInTheDocument() // <50 → Poor
    expect(screen.getByText('Triggered Rules')).toBeInTheDocument()
    expect(screen.getByText('R01_collision_danger')).toBeInTheDocument()
    expect(screen.getByText('R07_low_manipulability')).toBeInTheDocument()
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Collision')).toBeInTheDocument()
  })

  it('renders evidence chips with key and value', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    const chips = screen.getAllByTestId('assessment-evidence-chip')
    expect(chips).toHaveLength(3)
    expect(chips[0]).toHaveTextContent('manipulability: 0.200')
    expect(chips[1]).toHaveTextContent('singularity_proximity: 0.300')
  })

  it('uses English copy only (no regional variants or Spanish)', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    for (const label of [
      'Intelligent Assessment',
      'Risk Level',
      'Score',
      'Triggered Rules',
      'Evidence',
      'Recommendations',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText(/Inference Trace/)).toBeInTheDocument()
    for (const banned of ['Riesgo', 'Calidad', 'Traza', 'Evaluación']) {
      expect(screen.queryByText(banned)).not.toBeInTheDocument()
    }
  })
})

describe('IntelligentAssessment — collapsible inference trace', () => {
  it('is collapsed by default: the trace rows are not visible', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    const toggle = screen.getByTestId('assessment-trace-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Show Inference Trace')
    expect(screen.queryByTestId('assessment-trace')).not.toBeInTheDocument()
    expect(screen.queryByText('R01_collision_danger', { selector: 'tr *' })).toBeNull()
  })

  it('expands on click and shows each fired rule with bindings and derived output in order', () => {
    render(<IntelligentAssessment assessment={assessment} />)
    fireEvent.click(screen.getByTestId('assessment-trace-toggle'))
    const toggle = screen.getByTestId('assessment-trace-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('Hide Inference Trace')

    const rows = screen.getAllByTestId('assessment-trace-entry')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('R01_collision_danger')
    expect(rows[0]).toHaveTextContent('CollisionClearance IS danger=1.000')
    expect(rows[1]).toHaveTextContent('R07_low_manipulability')
    expect(rows[1]).toHaveTextContent('Manipulability IS low=0.667')
    expect(rows[1]).toHaveTextContent('danger_zone=true')
  })

  it('renders no recommendation rows when the assessment carries none', () => {
    render(<IntelligentAssessment assessment={{ ...assessment, recommendations: [] }} />)
    expect(screen.queryByTestId('assessment-recommendation')).not.toBeInTheDocument()
    expect(screen.queryByText('Recommendations')).not.toBeInTheDocument()
  })
})

describe('IntelligentAssessment — risk badge', () => {
  it('renders the categorical risk value on the badge', () => {
    const { unmount } = render(<IntelligentAssessment assessment={assessment} />)
    expect(within(screen.getByTestId('intelligent-assessment')).getByText('high')).toBeInTheDocument()
    unmount()

    render(<IntelligentAssessment assessment={{ ...assessment, risk: 'critical' }} />)
    expect(within(screen.getByTestId('intelligent-assessment')).getByText('critical')).toBeInTheDocument()
  })
})
