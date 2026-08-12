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
 * owning the rule reasoning (with agenda priority) and the dense evidence
 * table, CLOSED by default. The inference trace table is GONE — its priority
 * is now a RuleReasoning column, so no `assessment-trace*` testids exist. The
 * child testids (`rule-reasoning*`, `assessment-evidence*`) survive unchanged.
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

  it('expands on click to show rule reasoning (with priority) and the dense evidence table', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    fireEvent.click(screen.getByTestId('technical-details-toggle'))
    expect((screen.getByTestId('technical-details') as HTMLDetailsElement).open).toBe(true)

    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('3 rules')
    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(3)
    expect(screen.getAllByTestId('evidence-row')).toHaveLength(4)
    expect(screen.getAllByTestId('evidence-reading')).toHaveLength(4)

    // The trace table is gone: no `assessment-trace*` testids exist.
    expect(screen.queryByTestId('assessment-trace-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('assessment-trace')).not.toBeInTheDocument()
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

  it('renders the reasoning as a dense audit table with aligned columns and degrees', () => {
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

    const table = within(screen.getByTestId('rule-reasoning')).getByRole('table')
    expect(table).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Rule' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Why' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Produced' })).toBeInTheDocument()

    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(3)
    // Agenda priority merged from the trace entry (R01 priority 10).
    expect(within(rows[0]).getByTestId('rule-priority')).toHaveTextContent('10')
    // Untraced rules fall back to the rule's own priority.
    expect(within(rows[2]).getByTestId('rule-priority')).toHaveTextContent('1')
    const firstWhy = within(rows[0]).getByTestId('rule-why')
    expect(firstWhy).toHaveTextContent('Collision clearance is danger')
    expect(firstWhy).toHaveTextContent('· 1.000')
    const secondWhy = within(rows[1]).getByTestId('rule-why')
    expect(secondWhy).toHaveTextContent('Manipulability is low')
    expect(secondWhy).toHaveTextContent('· 0.667')
    expect(within(rows[1]).getByTestId('rule-produced')).toHaveTextContent('marked danger zone')
    // A rule without a trace entry still renders a row, with "—" for why/produced.
    expect(within(rows[2]).getByTestId('rule-why')).toHaveTextContent('—')
  })

  it('singularizes the rule count', () => {
    render(<TechnicalDetails rules={[rules[0]]} evidence={{}} trace={[]} />)
    expect(screen.getByTestId('technical-details-toggle')).toHaveTextContent('1 rule')
  })
})
