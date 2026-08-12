// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FactorRows } from './FactorRows'

/**
 * FactorRows (structural UX redesign) — the structured "why": one scannable
 * row per top factor (icon | label | value | severity bar | reading). Pins:
 * - rows rank by risk contribution (biggest problem leads);
 * - problem factors carry an AlertTriangle, positive a CheckCircle;
 * - bar and reading are colored by the semantic tone;
 * - narrative `primary_factors` select which rows render (hero ↔ rows agree);
 * - unknown keys never get a row.
 */

const evidence = {
  manipulability: 0.2, // risk 0.8 — Low / danger
  singularity_proximity: 0.5, // risk 0.5 — Near / danger
  collision_clearance: 0.6, // risk 0.4 — Safe / good
  trajectory_complexity: 12, // risk 1.0 — Very high / danger
}

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('FactorRows — structured rows (structural redesign)', () => {
  it('renders one row per factor: human label, formatted value, bar and reading', () => {
    render(<FactorRows evidence={evidence} />)
    const rows = screen.getAllByTestId('factor-row')
    expect(rows).toHaveLength(4)
    // Ranked by risk: complexity(1.0), manipulability(0.8), singularity(0.5), clearance(0.4).
    expect(rows[0]).toHaveTextContent('Very high trajectory complexity')
    expect(rows[0]).toHaveTextContent('12')
    expect(rows[0]).toHaveTextContent('Very high')
    expect(rows[1]).toHaveTextContent('Low manipulability')
    expect(rows[1]).toHaveTextContent('0.2')
    expect(rows[2]).toHaveTextContent('Near singularity')
    expect(rows[3]).toHaveTextContent('Safe clearance')
    expect(rows[3]).toHaveTextContent('0.6 m')
    // Human labels, never raw evidence keys.
    expect(screen.queryByText(/trajectory_complexity/i)).not.toBeInTheDocument()
  })

  it('uses AlertTriangle for problem factors and CheckCircle for positive factors', () => {
    render(<FactorRows evidence={evidence} />)
    const rows = screen.getAllByTestId('factor-row')
    expect(rows[0].querySelector('[data-icon="alert"]')).not.toBeNull()
    expect(rows[1].querySelector('[data-icon="alert"]')).not.toBeNull()
    expect(rows[2].querySelector('[data-icon="alert"]')).not.toBeNull()
    expect(rows[3].querySelector('[data-icon="check"]')).not.toBeNull()
  })

  it('colors bar and reading by semantic tone', () => {
    render(<FactorRows evidence={evidence} />)
    const rows = screen.getAllByTestId('factor-row')
    const dangerBar = rows[0].querySelector('[data-testid="factor-row-bar"]')
    expect(dangerBar?.className).toContain('bg-destructive')
    const safeBar = rows[3].querySelector('[data-testid="factor-row-bar"]')
    expect(safeBar?.className).toContain('bg-chart-3')
    expect(rows[3].querySelector('[data-testid="factor-row-reading"]')).toHaveTextContent('Safe')
  })

  it('limits the rows to the narrative primary factors when provided', () => {
    render(
      <FactorRows
        evidence={evidence}
        primaryFactors={[
          { key: 'manipulability', label: 'Low manipulability' },
          { key: 'collision_clearance', label: 'Safe clearance' },
        ]}
      />,
    )
    const rows = screen.getAllByTestId('factor-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Low manipulability')
    expect(rows[1]).toHaveTextContent('Safe clearance')
  })

  it('renders nothing when no factor can be derived (unknown keys only)', () => {
    render(<FactorRows evidence={{ collision_danger: 1.0 }} />)
    expect(screen.queryByTestId('factor-row')).not.toBeInTheDocument()
  })
})
