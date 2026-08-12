// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IntelligenceView } from './IntelligenceView'
import { qualityLabel } from './VerdictGauge'
import type { AssessmentWire } from '@/shared/contracts/analysis-report'

/**
 * IntelligenceView — composed Intelligence tab content (spec
 * evaluation-intelligence-tab): Verdict gauge → Triggered rules → Evidence
 * bars → collapsible Detail trace, all English copy.
 */

const assessment: AssessmentWire = {
  risk: 'low',
  quality: 0.82,
  triggered_rules: [
    { id: 'R01_collision_danger', category: 'collision', priority: 10 },
    { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
    { id: 'R12_complexity', category: 'trajectory', priority: 1 },
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

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('IntelligenceView — verdict gauge (spec scenario)', () => {
  it('shows quality label + score and the categorical risk', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const verdict = within(screen.getByTestId('assessment-verdict'))
    expect(verdict.getByText('Quality Score')).toBeInTheDocument()
    expect(verdict.getByText('0.82')).toBeInTheDocument()
    expect(verdict.getByText('GOOD')).toBeInTheDocument()
    expect(verdict.getByText('Risk Level')).toBeInTheDocument()
    expect(verdict.getByText('low')).toBeInTheDocument()
  })

  it('maps quality bands: ≥0.7 GOOD, ≥0.4 FAIR, below POOR', () => {
    expect(qualityLabel(0.82)).toBe('GOOD')
    expect(qualityLabel(0.5)).toBe('FAIR')
    expect(qualityLabel(0.2)).toBe('POOR')
  })
})

describe('IntelligenceView — triggered rules "why" (spec scenario)', () => {
  it('shows the count and rule chips labeled priority, never weight', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('3 rules triggered')
    const chips = screen.getAllByTestId('assessment-rule')
    expect(chips).toHaveLength(3)
    expect(chips[0]).toHaveTextContent('R01_collision_danger')
    expect(chips[0]).toHaveTextContent('priority 10')
    // The KB agenda priority must never be presented as a fuzzy weight.
    expect(screen.queryByText(/weight/i)).not.toBeInTheDocument()
  })
})

describe('IntelligenceView — membership bars "evidence" (spec scenario)', () => {
  it('shows one horizontal bar per evidence variable with proportional width', () => {
    render(<IntelligenceView assessment={assessment} regions={[]} />)
    const chips = screen.getAllByTestId('assessment-evidence-chip')
    expect(chips).toHaveLength(4)
    expect(chips[0]).toHaveTextContent('manipulability: 0.750')
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
