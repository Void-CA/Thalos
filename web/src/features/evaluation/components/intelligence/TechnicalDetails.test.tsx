// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TechnicalDetails } from './TechnicalDetails'
import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'

/**
 * TechnicalDetails — the inference AUDIT, ALWAYS visible (no collapsible): the
 * Intelligence tab is pure assessment now that the Advisor lives in its own
 * Repairs tab, so the reasoning no longer hides. Pins: the section header
 * "Inference trace" + count hint; rule reasoning (with priority) and the dense
 * evidence table render without any click.
 */

const rules: TriggeredRuleWire[] = [
  { id: 'R01_collision_danger', category: 'collision', priority: 10 },
  { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
]

const evidence = {
  manipulability: 0.75,
  singularity_proximity: 0.2,
  collision_clearance: 0.6,
}

const trace: AssessmentTraceEntryWire[] = [
  { rule_id: 'R01_collision_danger', priority: 10, bindings: {}, derived_output: {} },
]

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('TechnicalDetails — the inference audit, always visible', () => {
  it('renders the section with the count hint (no collapsible)', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    const section = screen.getByTestId('technical-details')
    expect(section.tagName).toBe('SECTION')
    expect(section).toHaveTextContent('Inference trace')
    expect(section).toHaveTextContent('2 rules')
    expect(section).toHaveTextContent('3 evidence')
  })

  it('shows the rule reasoning (with priority) and the dense evidence table without any click', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('2 rules')
    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(2)
    expect(screen.getAllByTestId('evidence-row')).toHaveLength(3)
    expect(screen.getAllByTestId('evidence-reading')).toHaveLength(3)
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
        derived_output: { low_manipulability: true },
      },
    ]
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={reasonedTrace} />)

    const rows = screen.getAllByTestId('rule-reasoning-row')
    // Trace (firing) order wins: R01, then R07.
    expect(rows).toHaveLength(2)

    expect(rows[0]).toHaveTextContent('Collision danger')
    expect(within(rows[0]).getByTestId('rule-why')).toHaveTextContent('Collision clearance is danger')
    expect(within(rows[0]).getByTestId('rule-produced')).toHaveTextContent('—')

    expect(rows[1]).toHaveTextContent('Low manipulability')
    expect(within(rows[1]).getByTestId('rule-why')).toHaveTextContent('Manipulability is low')
    expect(within(rows[1]).getByTestId('rule-produced')).toHaveTextContent('marked low manipulability')
  })

  it('shows the subtle category tag per reasoning row', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
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
        derived_output: { low_manipulability: true },
      },
    ]
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={reasonedTrace} />)

    const table = within(screen.getByTestId('rule-reasoning')).getByRole('table')
    expect(table).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Rule' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Why' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Produced' })).toBeInTheDocument()

    const rows = screen.getAllByTestId('rule-reasoning-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByTestId('rule-priority')).toHaveTextContent('10')
    expect(within(rows[1]).getByTestId('rule-priority')).toHaveTextContent('3')
    const firstWhy = within(rows[0]).getByTestId('rule-why')
    expect(firstWhy).toHaveTextContent('Collision clearance is danger')
    expect(firstWhy).toHaveTextContent('· 1.000')
    const secondWhy = within(rows[1]).getByTestId('rule-why')
    expect(secondWhy).toHaveTextContent('Manipulability is low')
    expect(secondWhy).toHaveTextContent('· 0.667')
    expect(within(rows[1]).getByTestId('rule-produced')).toHaveTextContent('marked low manipulability')
  })

  it('singularizes the rule count', () => {
    render(<TechnicalDetails rules={[rules[0]]} evidence={{}} trace={[]} />)
    expect(screen.getByTestId('technical-details')).toHaveTextContent('1 rule')
  })
})
