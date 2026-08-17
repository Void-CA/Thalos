import { describe, expect, it } from 'vitest'

import {
  manipulabilitySeriesOf,
  minClearanceDistance,
  minClearanceWaypoint,
  regionShareOfPlan,
  severityCounts,
  waypointAnalysisFromReport,
} from './analysis-report'
import type {
  AnalysisReportWire,
  AssessmentWire,
  CandidateRankingWire,
  MetricComparisonWire,
  MotionStrategyWire,
  NoCandidateReasonWire,
  RankedCandidateWire,
  SelectionReasonWire,
  StrategyOutcomeWire,
  StrategyTraceWire,
} from './analysis-report'

/** Minimal canonical report WITHOUT the new `manipulability_series` field —
 *  the "old client" payload shape (spec I3: additive backward compatibility). */
function baseReport(): AnalysisReportWire {
  return {
    artifact: { kind: 'MotionPlan', id: 'mp-1' },
    observations: [],
    actions: [],
    metrics: { waypoint_count: 3 },
    summary: {
      quality_index: 0.8,
      score: 80,
      grade: 'Good',
      observation_count: 0,
      severity_distribution: {},
    },
  }
}

describe('manipulability_series (S1 additive delta, spec motion-plan-endpoint)', () => {
  it('projects the series verbatim with waypoint + yoshikawa', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [
        { waypoint: 0, yoshikawa: 0.42, det_jtj: 0.18 },
        { waypoint: 1, yoshikawa: 0.31 },
        { waypoint: 2, yoshikawa: 0.18 },
      ],
    }

    expect(report.manipulability_series).toHaveLength(3)
    expect(report.manipulability_series?.[0]).toEqual({ waypoint: 0, yoshikawa: 0.42, det_jtj: 0.18 })
    expect(report.manipulability_series?.[0]?.det_jtj).toBeCloseTo(0.18)
    expect(report.manipulability_series?.[2]?.yoshikawa).toBeCloseTo(0.18)
    // Additive field: older payloads omit it — consumers must tolerate absence.
    expect(report.manipulability_series?.[1]?.det_jtj).toBeUndefined()
  })

  it('old payloads without the field degrade to an empty series (I3)', () => {
    const oldReport = baseReport() // no manipulability_series

    // I3: absent field must not break consumers — default to [].
    expect(manipulabilitySeriesOf(oldReport)).toEqual([])
    // Pre-existing derived helpers keep working unchanged.
    expect(severityCounts(oldReport)).toEqual({ error: 0, warning: 0, info: 0 })
    expect(waypointAnalysisFromReport(oldReport)).toEqual([])
  })
})

describe('waypointAnalysisFromReport — dense series (viewport coloring)', () => {
  it('colors manipulability from the DENSE series when there are no observations', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [
        { waypoint: 0, yoshikawa: 0.7 },
        { waypoint: 1, yoshikawa: 0.2 },
        { waypoint: 2, yoshikawa: 0.05 },
      ],
    }

    const view = waypointAnalysisFromReport(report)
    expect(view).toHaveLength(3)
    // Healthy plan, zero observations: no longer falls back to [].
    expect(view[0]).toMatchObject({ index: 0, manipulability: 0.7, severity: 'good' })
    expect(view[1]).toMatchObject({ index: 1, manipulability: 0.2, severity: 'warning' })
    expect(view[2]).toMatchObject({ index: 2, manipulability: 0.05, severity: 'critical' })
  })

  it('colors singularity from the DENSE singularity_series', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      singularity_series: [
        { waypoint: 0, singularity_state: 'normal' },
        { waypoint: 1, singularity_state: 'near' },
        { waypoint: 2, singularity_state: 'singular' },
      ],
    }

    const view = waypointAnalysisFromReport(report)
    expect(view).toHaveLength(3)
    expect(view[0]).toMatchObject({ index: 0, singularity_state: 'normal', severity: 'good' })
    expect(view[1]).toMatchObject({ index: 1, singularity_state: 'near', severity: 'warning' })
    expect(view[2]).toMatchObject({ index: 2, singularity_state: 'singular', severity: 'critical' })
  })

  it('merges both dense series into one entry per waypoint', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [
        { waypoint: 0, yoshikawa: 0.9 },
        { waypoint: 1, yoshikawa: 0.2 },
      ],
      singularity_series: [
        { waypoint: 0, singularity_state: 'near' }, // manipulability good but near-singular
        { waypoint: 1, singularity_state: 'normal' }, // manipulability already warning (0.2)
      ],
    }

    const view = waypointAnalysisFromReport(report)
    expect(view).toHaveLength(2)
    expect(view[0]).toMatchObject({ index: 0, manipulability: 0.9, singularity_state: 'near', severity: 'warning' })
    expect(view[1]).toMatchObject({ index: 1, manipulability: 0.2, singularity_state: 'normal', severity: 'warning' })
  })

  it('a report observation severity overrides the derived severity on that waypoint', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [
        { waypoint: 0, yoshikawa: 0.9 }, // derived good
        { waypoint: 1, yoshikawa: 0.8 },
      ],
      observations: [
        {
          id: 1,
          kind: 'Singularity',
          severity: 'Error',
          artifact: { kind: 'MotionPlan', id: 'mp-1' },
          location: { Waypoint: 0 },
          attributes: {},
          causes: [],
          related: [],
        },
      ],
    }

    const view = waypointAnalysisFromReport(report)
    expect(view.find(v => v.index === 0)).toMatchObject({ index: 0, severity: 'critical' })
  })
})

describe('analysis metrics accessors (R1/R4 — min clearance + waypoint)', () => {
  it('reads min_collision_distance / min_collision_waypoint from the wire metrics', () => {
    const metrics = {
      min_collision_distance: 0.035,
      min_collision_waypoint: 4,
      has_collisions: 0,
    }
    expect(minClearanceDistance(metrics)).toBe(0.035)
    expect(minClearanceWaypoint(metrics)).toBe(4)
  })

  it('returns null when the optional clearance keys are absent', () => {
    expect(minClearanceDistance({})).toBeNull()
    expect(minClearanceWaypoint({})).toBeNull()
  })

  it('rounds the waypoint index (wire metric is a usize projected as f64)', () => {
    expect(minClearanceWaypoint({ min_collision_waypoint: 3.0 })).toBe(3)
  })
})

describe('regionShareOfPlan (R5 — region as % of the plan)', () => {
  const region = {
    id: 7,
    kind: 'singularity',
    severity: 'critical',
    waypoint_start: 10,
    waypoint_end: 12,
    waypoint_count: 3,
  }
  const series = [
    { waypoint: 10, yoshikawa: 0.1, timestamp: 5 },
    { waypoint: 11, yoshikawa: 0.2, timestamp: 6 },
    { waypoint: 12, yoshikawa: 0.3, timestamp: 7 },
    { waypoint: 30, yoshikawa: 0.9, timestamp: 20 },
  ]

  it('derives the % of plan from waypoint_count and the span duration from timestamps', () => {
    const share = regionShareOfPlan(region, series, { waypoint_count: 30 })
    expect(share.percentOfPlan).toBe(10) // 3 / 30
    expect(share.durationSecs).toBe(2) // 7 - 5, out-of-range wp30 excluded
  })

  it('returns null percent when the plan metrics carry no waypoint_count', () => {
    const share = regionShareOfPlan(region, series, {})
    expect(share.percentOfPlan).toBeNull()
  })

  it('returns null duration when fewer than two series points carry timestamps', () => {
    const share = regionShareOfPlan(region, [{ waypoint: 10, yoshikawa: 0.1 }], { waypoint_count: 30 })
    expect(share.percentOfPlan).toBe(10)
    expect(share.durationSecs).toBeNull()
  })
})

describe('assessment (additive delta, spec analysis-report-contract)', () => {
  /** A wire Assessment as the backend DTO projects it (risk/category lowercase,
   *  bindings/derived_output as records). */
  const assessment: AssessmentWire = {
    risk: 'high',
    quality: 0.3,
    triggered_rules: [
      { id: 'R07_low_manipulability', category: 'manipulability', priority: 3 },
      { id: 'R11_danger_zone', category: 'manipulability', priority: 10 },
    ],
    evidence: { manipulability: 0.2, singularity_proximity: 0.4 },
    recommendations: [
      {
        action_kind: 'Manipulability',
        region_id: 3,
        rationale: 'Improve manipulability near the flagged region.',
      },
    ],
    trace: [
      {
        rule_id: 'R07_low_manipulability',
        priority: 3,
        bindings: { 'Manipulability IS low': '0.67' },
        derived_output: { danger_zone: true },
      },
      {
        rule_id: 'R11_danger_zone',
        priority: 10,
        bindings: { danger_zone: 'true' },
        derived_output: {},
      },
    ],
  }

  it('mirrors the backend DTO field-for-field (risk/quality/triggered_rules/evidence/recommendations/trace)', () => {
    const report: AnalysisReportWire = { ...baseReport(), assessment }
    expect(report.assessment).toEqual(assessment)
    expect(report.assessment?.risk).toBe('high')
    expect(report.assessment?.quality).toBe(0.3)
    expect(report.assessment?.triggered_rules).toHaveLength(2)
    expect(report.assessment?.triggered_rules?.[0]).toEqual({
      id: 'R07_low_manipulability',
      category: 'manipulability',
      priority: 3,
    })
    expect(report.assessment?.evidence).toEqual({
      manipulability: 0.2,
      singularity_proximity: 0.4,
    })
    expect(report.assessment?.recommendations?.[0]?.region_id).toBe(3)
    expect(report.assessment?.trace?.[0]?.bindings).toEqual({ 'Manipulability IS low': '0.67' })
    expect(report.assessment?.trace?.[0]?.derived_output).toEqual({ danger_zone: true })
  })

  it('is optional on AnalysisReportWire — old payloads omit it (I3)', () => {
    const oldReport: AnalysisReportWire = baseReport()
    expect(oldReport.assessment).toBeUndefined()
    expect(JSON.stringify(oldReport)).not.toContain('assessment')
  })

  it('preserves trace firing order on the wire', () => {
    const report: AnalysisReportWire = { ...baseReport(), assessment }
    const ids = report.assessment?.trace.map((entry) => entry.rule_id) ?? []
    expect(ids).toEqual(['R07_low_manipulability', 'R11_danger_zone'])
  })
})

describe('normalized_yoshikawa + manipulability_grade (additive delta, spec analysis-report-contract)', () => {
  it('new backend payload carries normalized + grade per point', () => {
    const report: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [
        { waypoint: 0, yoshikawa: 0.42, det_jtj: 0.18, normalized_yoshikawa: 0.21, manipulability_grade: 'medium' },
        { waypoint: 1, yoshikawa: 0.05, normalized_yoshikawa: 0.02, manipulability_grade: 'low' },
        { waypoint: 2, yoshikawa: 0.9, normalized_yoshikawa: 0.6, manipulability_grade: 'high' },
      ],
    }

    expect(report.manipulability_series?.[0]?.normalized_yoshikawa).toBeCloseTo(0.21)
    expect(report.manipulability_series?.[0]?.manipulability_grade).toBe('medium')
    expect(report.manipulability_series?.[1]?.manipulability_grade).toBe('low')
    expect(report.manipulability_series?.[2]?.manipulability_grade).toBe('high')
    // Raw yoshikawa remains on the wire untouched (spec "raw yoshikawa stays").
    expect(report.manipulability_series?.[2]?.yoshikawa).toBeCloseTo(0.9)
  })

  it('legacy payload omits the new fields (undefined = fallback signal)', () => {
    const legacy: AnalysisReportWire = {
      ...baseReport(),
      manipulability_series: [{ waypoint: 0, yoshikawa: 0.42, det_jtj: 0.18 }],
    }

    // Absence IS the presence signal for the frontend fallback (grade None =
    // legacy payload). Field must be undefined, never a fabricated value.
    expect(legacy.manipulability_series?.[0]?.normalized_yoshikawa).toBeUndefined()
    expect(legacy.manipulability_series?.[0]?.manipulability_grade).toBeUndefined()
    expect(manipulabilitySeriesOf(legacy)).toHaveLength(1)
  })
})

describe('candidate_ranking (additive delta, spec candidate-alternatives-demo)', () => {
  /** The canonical CandidateRanking as the backend DTO projects it — mirrors
   *  `CandidateRankingDto` field-for-field (ranked / selected? / reason /
   *  strategy_trace). Values are shape-checking data, not the demo instance. */
  const ranking: CandidateRankingWire = {
    ranked: [
      { strategy: 'Direct', risk: 0.5, duration: 7.8, manipulability: 0.45, length: 3.8, cost: 1 },
      {
        strategy: 'AlternateElbow',
        risk: 0.16,
        duration: 5.2,
        manipulability: 0.63,
        length: 2.1,
        cost: 0,
      },
    ],
    selected: 'AlternateElbow',
    reason: {
      kind: 'selected',
      strategy: 'AlternateElbow',
      metric_comparison: [
        { component: 'risk', selected_value: 0.16, baseline_value: 0.5 },
        { component: 'duration', selected_value: 5.2, baseline_value: 7.8 },
        { component: 'manipulability', selected_value: 0.63, baseline_value: 0.45 },
        { component: 'length', selected_value: 2.1, baseline_value: 3.8 },
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

  it('mirrors the Rust CandidateRankingDto field-for-field (ranked/selected?/reason/strategy_trace)', () => {
    // The DTO shape is { ranked, selected (Option), reason, strategy_trace }
    // — the wire MUST carry exactly these four keys.
    const keys = Object.keys(ranking).sort()
    expect(keys).toEqual(['ranked', 'reason', 'selected', 'strategy_trace'])
    expect(ranking.ranked).toHaveLength(2)
    expect(ranking.selected).toBe('AlternateElbow')
    expect(ranking.strategy_trace).toHaveLength(3)
  })

  it('RankedCandidateWire carries exactly strategy/risk/duration/manipulability/length/cost', () => {
    const row: RankedCandidateWire = ranking.ranked[0]
    const keys = Object.keys(row).sort()
    expect(keys).toEqual(['cost', 'duration', 'length', 'manipulability', 'risk', 'strategy'])
    // Numeric fields are raw wire numbers — never normalized by the contract.
    expect(row.risk).toBeCloseTo(0.5)
    expect(row.duration).toBeCloseTo(7.8)
    expect(row.manipulability).toBeCloseTo(0.45)
    expect(row.length).toBeCloseTo(3.8)
    expect(row.cost).toBeCloseTo(1)
  })

  it('SelectionReasonWire selected variant: metric_comparison vs Direct baseline + optional endpoints/task', () => {
    const reason: SelectionReasonWire = ranking.reason
    expect(reason.kind).toBe('selected')
    if (reason.kind !== 'selected') throw new Error('expected selected reason')
    expect(reason.strategy).toBe('AlternateElbow')
    const components: MetricComparisonWire[] = reason.metric_comparison
    expect(components).toHaveLength(5)
    expect(components[0]).toEqual({ component: 'risk', selected_value: 0.16, baseline_value: 0.5 })
    // The direction (< / >) is DERIVABLE from the values — never carried.
    expect(components[1].selected_value).toBeLessThan(components[1].baseline_value)
    // Faithful to the Rust Option<String>: endpoints/task are OPTIONAL and
    // absent when the backend omits them.
    expect(reason.endpoints).toBe('Endpoints: preserved')
    expect(reason.task).toBe('Task: preserved')
  })

  it('SelectionReasonWire no_admissible_candidate variant carries the structural reason', () => {
    const noSelection: SelectionReasonWire = {
      kind: 'no_admissible_candidate',
      reason: 'All candidates failed the admissibility gate',
    }
    expect(noSelection.kind).toBe('no_admissible_candidate')
    if (noSelection.kind !== 'no_admissible_candidate') throw new Error('expected no-admissible')
    expect(noSelection.reason).toContain('admissibility')
    // A no-admissible reason NEVER carries a metric comparison.
    expect('metric_comparison' in noSelection).toBe(false)
  })

  it('closed unions: MotionStrategyWire and MetricComponentWire accept only the DTO variants', () => {
    const strategies: MotionStrategyWire[] = ['Direct', 'InsertWaypoint', 'AlternateElbow']
    expect(strategies).toEqual(['Direct', 'InsertWaypoint', 'AlternateElbow'])
    const components: MetricComparisonWire[] = [
      { component: 'risk', selected_value: 1, baseline_value: 2 },
      { component: 'duration', selected_value: 1, baseline_value: 2 },
      { component: 'manipulability', selected_value: 1, baseline_value: 2 },
      { component: 'length', selected_value: 1, baseline_value: 2 },
      { component: 'cost', selected_value: 1, baseline_value: 2 },
    ]
    expect(components.map((c) => c.component)).toEqual([
      'risk',
      'duration',
      'manipulability',
      'length',
      'cost',
    ])
  })

  it('NoCandidateReasonWire mirrors the Rust enum: IkFailed | UnsupportedSegment | InvariantViolation{invariant}', () => {
    const ik: NoCandidateReasonWire = 'IkFailed'
    const unsupported: NoCandidateReasonWire = 'UnsupportedSegment'
    const invariant: NoCandidateReasonWire = { InvariantViolation: { invariant: 'segment_out_of_range' } }
    // Externally-tagged serde shape: the variant name is the key.
    expect(JSON.parse(JSON.stringify(invariant))).toEqual({
      InvariantViolation: { invariant: 'segment_out_of_range' },
    })
    expect(ik).toBe('IkFailed')
    expect(unsupported).toBe('UnsupportedSegment')
  })

  it('StrategyTraceWire/StrategyOutcomeWire: generated rows carry no reason; skipped rows carry it', () => {
    const trace: StrategyTraceWire[] = ranking.strategy_trace
    const generated: StrategyOutcomeWire = trace[0].outcome
    expect(generated.kind).toBe('generated')
    expect(generated.reason).toBeUndefined()
    const skipped: StrategyOutcomeWire = trace[1].outcome
    expect(skipped.kind).toBe('skipped')
    expect(skipped.reason).toBe('UnsupportedSegment')
  })

  it('candidate_ranking is optional on AnalysisReportWire — old payloads omit it (I3)', () => {
    const oldReport: AnalysisReportWire = baseReport()
    expect(oldReport.candidate_ranking).toBeUndefined()
    expect(JSON.stringify(oldReport)).not.toContain('candidate_ranking')
  })

  it('the additive field round-trips on the wire without altering existing fields', () => {
    const report: AnalysisReportWire = { ...baseReport(), candidate_ranking: ranking }
    expect(report.candidate_ranking).toEqual(ranking)
    // The rest of the canonical report is untouched by the additive field.
    expect(report.artifact).toEqual({ kind: 'MotionPlan', id: 'mp-1' })
    expect(report.summary.quality_index).toBeCloseTo(0.8)
    expect(report.assessment).toBeUndefined()
  })
})
