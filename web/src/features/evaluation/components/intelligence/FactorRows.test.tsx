// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FactorRows } from './FactorRows'

/**
 * FactorRows — the scannable factor table (label | value | reading). Pins:
 * - rows rank by risk contribution (biggest problem leads);
 * - the reading is color-coded by the semantic tone (no bars, no icons — the
 *   information is the hierarchy);
 * - narrative `primary_factors` select which rows render (hero ↔ rows agree);
 * - unknown keys never get a row.
 */

const evidence = {
  manipulability: 0.2, // risk 0.8 — Low / danger
  singularity_proximity: 0.5, // risk 0.5 — Singular event / danger
  collision_clearance: 0.6, // risk 0.4 — Safe / good
}

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('FactorRows — scannable factor table', () => {
  it('renders one row per factor: human label, formatted value and semantic reading', () => {
    render(<FactorRows evidence={evidence} />)
    const rows = screen.getAllByTestId('factor-row')
    expect(rows).toHaveLength(3)
    // Ranked by risk: manipulability(0.8), singularity(0.5), clearance(0.4).
    expect(rows[0]).toHaveTextContent('Low manipulability')
    expect(rows[0]).toHaveTextContent('0.2')
    expect(rows[0]).toHaveTextContent('Low')
    expect(rows[1]).toHaveTextContent('Singular event')
    expect(rows[1]).toHaveTextContent('0.5')
    expect(rows[1]).toHaveTextContent('Singular')
    expect(rows[2]).toHaveTextContent('Safe clearance')
    expect(rows[2]).toHaveTextContent('0.6 m')
    expect(rows[2]).toHaveTextContent('Safe')
    // Human labels, never raw evidence keys.
    expect(screen.queryByText(/singularity_proximity/i)).not.toBeInTheDocument()
  })

  it('colors the reading by the semantic tone (danger / warn / good)', () => {
    render(<FactorRows evidence={evidence} />)
    const rows = screen.getAllByTestId('factor-row')
    expect(rows[0].querySelector('[data-testid="factor-row-reading"]')?.className).toContain(
      'text-destructive',
    )
    expect(rows[2].querySelector('[data-testid="factor-row-reading"]')?.className).toContain(
      'text-chart-3',
    )
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
