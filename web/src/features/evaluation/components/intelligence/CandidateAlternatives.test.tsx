// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CandidateAlternatives } from './CandidateAlternatives'
import type {
  AnalysisReportWire,
  CandidateRankingWire,
} from '@/shared/contracts/analysis-report'

/**
 * CandidateAlternatives — the ALTERNATIVE SYNTHESIS → SELECTION layer of the
 * Intelligence tab (level 2 + 3; level 1 INTELLIGENT ASSESSMENT is the
 * existing view, untouched). Purely wire-driven: every value rendered comes
 * from `report.candidate_ranking` verbatim; the component never re-derives
 * risk, quality (except the display projection `1 − risk`), cost or selection.
 */

/** A minimal ranking with NON-demo numbers — any assertion on a rendered value
 *  MUST prove the text came from the wire, never from a hardcoded constant. */
const ranking: CandidateRankingWire = {
  ranked: [
    { strategy: 'Direct', risk: 0.4, duration: 10, manipulability: 0.3, length: 5, cost: 1 },
    { strategy: 'AlternateElbow', risk: 0.2, duration: 6, manipulability: 0.6, length: 3, cost: 0 },
  ],
  selected: 'AlternateElbow',
  reason: {
    kind: 'selected',
    strategy: 'AlternateElbow',
    metric_comparison: [
      { component: 'risk', selected_value: 0.2, baseline_value: 0.4 },
      { component: 'duration', selected_value: 6, baseline_value: 10 },
      { component: 'manipulability', selected_value: 0.6, baseline_value: 0.3 },
      { component: 'length', selected_value: 3, baseline_value: 5 },
      { component: 'cost', selected_value: 0, baseline_value: 1 },
    ],
    endpoints: 'Endpoints: preserved',
    task: 'Task: preserved',
  },
  strategy_trace: [
    { strategy: 'Direct', outcome: { kind: 'generated' } },
    {
      strategy: 'InsertWaypoint',
      outcome: { kind: 'skipped', reason: 'UnsupportedSegment' },
    },
    { strategy: 'AlternateElbow', outcome: { kind: 'generated' } },
  ],
}

function reportWith(overrides: Partial<CandidateRankingWire> = {}): AnalysisReportWire {
  return {
    artifact: { kind: 'MotionPlan', id: 'plan-1' },
    observations: [],
    actions: [],
    metrics: { singular_count: 2, waypoint_count: 30 },
    summary: {
      quality_index: 0.72,
      score: 72,
      grade: 'Good',
      observation_count: 0,
      severity_distribution: {},
    },
    candidate_ranking: { ...ranking, ...overrides },
  }
}

beforeEach(() => cleanup())
afterEach(() => cleanup())

describe('CandidateAlternatives — gating (wire-driven presence)', () => {
  it('renders nothing when report.candidate_ranking is undefined', () => {
    const report: AnalysisReportWire = {
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      observations: [],
      actions: [],
      metrics: {},
      summary: {
        quality_index: 0.72,
        score: 72,
        grade: 'Good',
        observation_count: 0,
        severity_distribution: {},
      },
    }
    const { container } = render(<CandidateAlternatives report={report} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('candidate-alternatives')).not.toBeInTheDocument()
  })

  it('renders the section when candidate_ranking is present', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    expect(screen.getByTestId('candidate-alternatives')).toBeInTheDocument()
  })
})

describe('CandidateAlternatives — three-level hierarchy (synthesis → selection)', () => {
  it('labels level 2 ALTERNATIVE SYNTHESIS and level 3 SELECTION as a distinct conclusion', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const section = screen.getByTestId('candidate-alternatives')
    expect(section).toHaveTextContent('Alternative Synthesis')
    expect(section).toHaveTextContent('Selection')
    // The selection is a distinct conclusion block, not just a highlighted row.
    expect(screen.getByTestId('selection-conclusion')).toBeInTheDocument()
  })
})

describe('CandidateAlternatives — comparison table (wire rows)', () => {
  it('renders exactly ranked.length rows with strategy, status, risk, quality, singular, manipulability, length, cost', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const rows = screen.getAllByTestId('candidate-row')
    expect(rows).toHaveLength(ranking.ranked.length)
    expect(rows).toHaveLength(2)

    // Direct row: all wire values verbatim.
    const direct = rows[0]
    expect(within(direct).getByTestId('candidate-strategy')).toHaveTextContent('Direct')
    expect(within(direct).getByTestId('candidate-risk')).toHaveTextContent('0.4000')
    expect(within(direct).getByTestId('candidate-manipulability')).toHaveTextContent('0.3000')
    expect(within(direct).getByTestId('candidate-length')).toHaveTextContent('5.000')
    expect(within(direct).getByTestId('candidate-cost')).toHaveTextContent('1.0000')

    // AlternateElbow row: wire values verbatim (NOT the demo 0.5571/0.1625).
    const ae = rows[1]
    expect(within(ae).getByTestId('candidate-strategy')).toHaveTextContent('AlternateElbow')
    expect(within(ae).getByTestId('candidate-risk')).toHaveTextContent('0.2000')
  })

  it('shows the per-strategy status from strategy_trace (Generated for ranked strategies)', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const rows = screen.getAllByTestId('candidate-row')
    // Direct + AlternateElbow are Generated in the trace → status column says so.
    for (const row of rows) {
      expect(within(row).getByTestId('candidate-status')).toHaveTextContent('Generated')
    }
  })

  it('highlights the SELECTED row (candidate_ranking.selected), other rows not', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const rows = screen.getAllByTestId('candidate-row')
    expect(rows[0]).toHaveAttribute('data-selected', 'false')
    expect(rows[1]).toHaveAttribute('data-selected', 'true')
    expect(within(rows[1]).getByTestId('candidate-selection')).toHaveTextContent('Selected')
    expect(within(rows[0]).queryByTestId('candidate-selection')?.textContent).not.toContain(
      'Selected',
    )
  })

  it('labels the quality column "Assessed quality" (never a bare "Quality") and derives 1 − risk', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    // Exact-match lookup: a bare "Quality" heading must NOT exist.
    expect(screen.queryByText('Quality')).not.toBeInTheDocument()
    expect(screen.getByText('Assessed quality')).toBeInTheDocument()
    const rows = screen.getAllByTestId('candidate-row')
    // 1 − 0.4 = 0.6, 1 − 0.2 = 0.8 — display projection of the SAME wire risk.
    expect(within(rows[0]).getByTestId('candidate-quality')).toHaveTextContent('0.6000')
    expect(within(rows[1]).getByTestId('candidate-quality')).toHaveTextContent('0.8000')
  })

  it('renders the analyzer plan-level singular_count on the Direct baseline row and "—" for generated rows', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const rows = screen.getAllByTestId('candidate-row')
    // Direct IS the analyzed plan (baseline equivalence): the plan-level
    // analyzer metric is the Direct row's count. No per-candidate wire data
    // for generated rows → "—" (display-only, never re-derived).
    expect(within(rows[0]).getByTestId('candidate-singular')).toHaveTextContent('2')
    expect(within(rows[1]).getByTestId('candidate-singular')).toHaveTextContent('—')
  })
})

describe('CandidateAlternatives — strategy trace (Generated / Skipped + reason)', () => {
  it('renders one entry per strategy_trace row with Generated/Skipped status', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const entries = screen.getAllByTestId('strategy-trace-entry')
    expect(entries).toHaveLength(ranking.strategy_trace.length)
    expect(entries[0]).toHaveTextContent('Direct')
    expect(entries[0]).toHaveTextContent('Generated')
    expect(entries[1]).toHaveTextContent('InsertWaypoint')
    expect(entries[1]).toHaveTextContent('Skipped')
    expect(entries[2]).toHaveTextContent('AlternateElbow')
    expect(entries[2]).toHaveTextContent('Generated')
  })

  it('skipped strategy reason comes from the wire and is expandable (Unsupported segment)', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const skip = screen.getByTestId('strategy-trace-skip')
    // Collapsed: the reason summary (humanized from the wire variant) is visible.
    expect(skip).toHaveTextContent('Unsupported segment')
    expect(screen.queryByTestId('strategy-trace-skip-reason')).not.toBeInTheDocument()
    // Expand: the detail reveals the structural reason.
    fireEvent.click(skip)
    const reason = screen.getByTestId('strategy-trace-skip-reason')
    expect(reason).toHaveTextContent('Unsupported segment')
    expect(reason).toHaveTextContent('InsertWaypoint')
  })

  it('InvariantViolation reason renders its invariant (wire-derived)', () => {
    render(
      <CandidateAlternatives
        report={reportWith({
          strategy_trace: [
            { strategy: 'Direct', outcome: { kind: 'generated' } },
            {
              strategy: 'InsertWaypoint',
              outcome: { kind: 'skipped', reason: { InvariantViolation: { invariant: 'segment_out_of_range' } } },
            },
          ],
        })}
      />,
    )
    const skip = screen.getByTestId('strategy-trace-skip')
    expect(skip).toHaveTextContent('Invariant violation: segment_out_of_range')
    fireEvent.click(skip)
    expect(screen.getByTestId('strategy-trace-skip-reason')).toHaveTextContent(
      'Invariant violation: segment_out_of_range',
    )
  })
})

describe('CandidateAlternatives — selection reason (derived, never hardcoded)', () => {
  it('derives the conclusion from reason.metric_comparison — the wire values appear verbatim', () => {
    render(<CandidateAlternatives report={reportWith()} />)
    const conclusion = screen.getByTestId('selection-conclusion')
    // Derived from the wire: risk 0.2 vs 0.4 (Direct) — NOT a hardcoded sentence.
    expect(conclusion).toHaveTextContent('AlternateElbow')
    expect(conclusion).toHaveTextContent('Risk')
    expect(conclusion).toHaveTextContent('0.2000')
    expect(conclusion).toHaveTextContent('0.4000')
    // The fixed invariants from the wire.
    expect(conclusion).toHaveTextContent('Endpoints: preserved')
    expect(conclusion).toHaveTextContent('Task: preserved')
  })

  it('no_admissible_candidate reason renders the structural reason and no metric comparison', () => {
    render(
      <CandidateAlternatives
        report={reportWith({
          selected: undefined,
          ranked: [{ strategy: 'Direct', risk: 0.9, duration: 8, manipulability: 0.1, length: 4, cost: 0 }],
          reason: { kind: 'no_admissible_candidate', reason: 'All candidates failed the admissibility gate' },
          strategy_trace: [
            { strategy: 'Direct', outcome: { kind: 'generated' } },
            { strategy: 'InsertWaypoint', outcome: { kind: 'skipped', reason: 'UnsupportedSegment' } },
          ],
        })}
      />,
    )
    const conclusion = screen.getByTestId('selection-conclusion')
    expect(conclusion).toHaveTextContent('All candidates failed the admissibility gate')
    // No metric comparison block when the wire says no_admissible_candidate.
    expect(screen.queryByTestId('selection-metric-comparison')).not.toBeInTheDocument()
  })

  it('is display-only: the rendered risk is the wire risk verbatim (no re-derivation)', () => {
    const report = reportWith()
    render(<CandidateAlternatives report={report} />)
    const ae = screen.getAllByTestId('candidate-row')[1]
    const wireRisk = report.candidate_ranking!.ranked[1].risk
    expect(within(ae).getByTestId('candidate-risk')).toHaveTextContent(wireRisk.toFixed(4))
    expect(within(ae).getByTestId('candidate-quality')).toHaveTextContent((1 - wireRisk).toFixed(4))
  })
})

describe('CandidateAlternatives — no hardcoded counterfactual numbers in the UI', () => {
  it('component source contains no 0.5571 / 0.1625 literals (numbers come only from the wire)', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'CandidateAlternatives.tsx'),
      'utf8',
    )
    expect(source).not.toContain('0.5571')
    expect(source).not.toContain('0.1625')
  })
})
