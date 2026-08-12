// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { NarrativeSummaryCard } from './NarrativeSummaryCard'
import type { AssessmentWire, ProblemRegionWire } from '@/shared/contracts/analysis-report'

/**
 * NarrativeSummaryCard (intelligible-repair-loop 2.1) — the intelligible
 * narrative of the Intelligence tab: headline + grounded summary + primary
 * factor chips. Pins:
 * - headline/summary derive from the wire through `buildNarrativeSummary`
 *   (assessment + regions only);
 * - every factor chip carries a TRACEABLE evidence key (`title` attribute =
 *   the key in the input evidence);
 * - recommendation_context line appears only when the assessment references
 *   recommendations;
 * - the card renders nothing when the assessment is absent.
 */

const assessment: AssessmentWire = {
  risk: 'high',
  quality: 0.31,
  triggered_rules: [{ id: 'R07_low_manipulability', category: 'manipulability', priority: 3 }],
  evidence: { manipulability: 0.2, singularity_proximity: 0.4 },
  recommendations: [],
  trace: [],
}

const region: ProblemRegionWire = {
  id: 3,
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

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('NarrativeSummaryCard — narrative display (2.1)', () => {
  it('renders the headline and the grounded summary sentences (risk, quality, region cause + span)', () => {
    render(<NarrativeSummaryCard assessment={assessment} regions={[region]} />)
    const card = screen.getByTestId('narrative-summary')
    expect(card).toHaveTextContent('High risk plan')
    expect(card).toHaveTextContent('0.31')
    expect(card).toHaveTextContent('Singularity near waypoint 10')
    expect(card).toHaveTextContent('wp10')
    expect(card).toHaveTextContent('wp20')
  })

  it('renders one chip per primary factor with the label and the traceable evidence key as title', () => {
    render(<NarrativeSummaryCard assessment={assessment} regions={[]} />)
    const chips = screen.getAllByTestId('narrative-factor-chip')
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      // Traceability: the title attribute IS an evidence key of the input.
      expect(Object.prototype.hasOwnProperty.call(assessment.evidence, chip.title)).toBe(true)
    }
    expect(chips[0]).toHaveTextContent('Manipulability')
    expect(chips[0]).toHaveAttribute('title', 'manipulability')
  })

  it('shows the recommendation context line only when the assessment references recommendations', () => {
    const { rerender } = render(<NarrativeSummaryCard assessment={assessment} regions={[]} />)
    expect(screen.queryByText(/repair recommendation/i)).not.toBeInTheDocument()

    rerender(
      <NarrativeSummaryCard
        assessment={{
          ...assessment,
          recommendations: [
            {
              action_kind: 'Manipulability',
              region_id: 3,
              rationale: 'Improve manipulability near the flagged region.',
            },
          ],
        }}
        regions={[]}
      />,
    )
    expect(screen.getByText(/1 repair recommendation/i)).toBeInTheDocument()
  })

  it('renders nothing when the assessment is absent (narrative hidden)', () => {
    render(<NarrativeSummaryCard assessment={null} regions={[]} />)
    expect(screen.queryByTestId('narrative-summary')).not.toBeInTheDocument()
  })
})
