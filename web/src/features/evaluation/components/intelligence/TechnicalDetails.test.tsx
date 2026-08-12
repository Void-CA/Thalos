// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TechnicalDetails } from './TechnicalDetails'
import type {
  AssessmentTraceEntryWire,
  TriggeredRuleWire,
} from '@/shared/contracts/analysis-report'

/**
 * TechnicalDetails (structural UX redesign) — ONE collapsible detail section
 * owning the triggered rules, the evidence bars and the inference trace,
 * CLOSED by default. The child testids (`assessment-rule*`,
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

  it('expands on click to show rules, evidence bars and the inference trace', () => {
    render(<TechnicalDetails rules={rules} evidence={evidence} trace={trace} />)
    fireEvent.click(screen.getByTestId('technical-details-toggle'))
    expect((screen.getByTestId('technical-details') as HTMLDetailsElement).open).toBe(true)

    expect(screen.getByTestId('assessment-rule-count')).toHaveTextContent('3 rules')
    expect(screen.getAllByTestId('assessment-rule')).toHaveLength(3)
    expect(screen.getAllByTestId('assessment-evidence-chip')).toHaveLength(4)
    expect(screen.getAllByTestId('evidence-reading')).toHaveLength(4)

    const traceToggle = screen.getByTestId('assessment-trace-toggle')
    expect(traceToggle).toHaveTextContent('Show')
    fireEvent.click(traceToggle)
    expect(screen.getByTestId('assessment-trace')).toBeInTheDocument()
    expect(screen.getAllByTestId('assessment-trace-entry')).toHaveLength(1)
  })

  it('singularizes the rule count', () => {
    render(<TechnicalDetails rules={[rules[0]]} evidence={{}} trace={[]} />)
    expect(screen.getByTestId('technical-details-toggle')).toHaveTextContent('1 rule')
  })
})
