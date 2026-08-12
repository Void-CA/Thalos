// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TechnicalDetails } from './TechnicalDetails'
import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'

/**
 * TechnicalDetails (structural UX redesign) — ONE collapsible detail section
 * owning the rule reasoning, the evidence bars and the inference trace,
 * CLOSED by default. The child testids (`rule-reasoning*`,
 * `assessment-evidence*`, `assessment-trace*`) survive unchanged.
 */

const rules: TriggeredRuleWire[] = [
  { id: 'R01_collision_danger', category: 'collision', priority: 10 },
  { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
  { id: 'R06_high_complexity', category: 'trajectory', priority: 1 },
]

const evidence = {
  manipulability: 0.75,
  singularity_proximity: 0.2,
  collision_clearance: 0.6,
  trajectory_complexity: 0.4,
}

const trace: AssessmentTraceEntryWire[] = [
  { rule_id: 'R01_collision_danger', priority: 10, bindings: {}, derived_output: {} },
]

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('TechnicalDetails — ONE collapsible detail section (closed by default)', () => {
  it('is collapsed by default and shows the count hint in the toggle', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    expect((screen.getByTestId('technical-details') as HTMLDetailsElement).open).toBe(false)
    const toggle = screen.getByTestId('technical-details-toggle')
    expect(toggle).toHaveTextContent('Technical details')
    expect(toggle).toHaveTextContent('3 rules')
    expect(toggle).toHaveTextContent('4 evidence')
  })

  it('expands on click to show rule reasoning, evidence bars and the inference trace', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    fireEvent.click(screen.getByTestId('technical-details-toggle'))
    expect((screen.getByTestId('technical-details') as HTMLDetailsElement).open).toBe(true)

    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('3 rules')
    expect(screen.getAllByTestId('rule-reasoning-row')).toHaveLength(3)
    expect(screen.getAllByTestId('assessment-evidence-chip')).toHaveLength(4)
    expect(screen.getAllByTestId('evidence-reading')).toHaveLength(4)

    const traceToggle = screen.getByTestId('assessment-trace-toggle')
    expect(traceToggle).toHaveTextContent('Show')
    fireEvent.click(traceToggle)
    expect(screen.getByTestId('assessment-trace')).toBeInTheDocument()
    expect(screen.getAllByTestId('assessment-trace-entry')).toHaveLength(1)
  })

  it('shows the real rule reasoning — why (bindings) and produced (derived output) per fired rule', () => {
    const reasonedTrace: AssessmentTraceEntryWire[] = [
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
    ]
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={reasonedTrace} />)
    fireEvent.click(screen.getByTestId('technical-details-toggle'))

    const rows = screen.getAllByTestId('rule-reasoning-row')
    // Trace (firing) order wins: R01, R07, then the untraced rule in rules order.
    expect(rows).toHaveLength(3)

    expect(rows[0]).toHaveTextContent('Collision danger')
    expect(within(rows[0]).getByTestId('rule-why')).toHaveTextContent('Collision clearance is danger')
    expect(within(rows[0]).getByTestId('rule-produced')).toHaveTextContent('—')

    expect(rows[1]).toHaveTextContent('Low manipulability')
    expect(within(rows[1]).getByTestId('rule-why')).toHaveTextContent('Manipulability is low')
    expect(within(rows[1]).getByTestId('rule-produced')).toHaveTextContent('marked danger zone')

    // A rule with no trace entry still renders, with "—" for why/produced.
    expect(rows[2]).toHaveTextContent('High trajectory complexity')
    expect(within(rows[2]).getByTestId('rule-why')).toHaveTextContent('—')
    expect(within(rows[2]).getByTestId('rule-produced')).toHaveTextContent('—')
  })

  it('shows the subtle category tag per reasoning row', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    fireEvent.click(screen.getByTestId('technical-details-toggle'))
    const row = screen.getAllByTestId('rule-reasoning-row')[0]
    expect(row).toHaveTextContent('Collision')
    expect(row).toHaveTextContent('Collision danger')
  })

  it('singularizes the rule count', () => {
    render(<TechnicalDetails rules={[rules[0]]} evidence={{}} trace={[]} />)
    expect(screen.getByTestId('technical-details-toggle')).toHaveTextContent('1 rule')
  })
})
