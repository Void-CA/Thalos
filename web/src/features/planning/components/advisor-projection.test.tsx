// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AdvisorSection } from './AdvisorSection'
import type { AnalysisReportWire } from '@/shared/contracts/analysis-report'

/**
 * S4b / S4.3 — Advisor projection (spec advisor-projection):
 * - AdvisorSection is a PURE consumer: receives the canonical AnalysisReportWire
 *   via props, imports zero planning stores and zero backend hooks.
 * - Interpretation is structural (Observation.kind / severity / actions /
 *   summary) — never by matching message text.
 * - API: <AdvisorSection report={report} /> — no legacy props.
 *
 * The analyzed-router tests seed `score: 92 / grade: 'Good'` in StatusBanner;
 * this projection must therefore render its summary with explicit labels
 * (e.g. "Score: 92", "Grade: Good") so it never emits a bare '92 / 100' or
 * 'Good' text node that would collide with the existing StatusBanner.
 */

const fullReport: AnalysisReportWire = {
  artifact: { kind: 'MotionPlan', id: 'plan-1' },
  observations: [
    {
      id: 1,
      kind: 'LowManipulability',
      severity: 'Warning',
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      location: { Waypoint: 3 },
      attributes: { value: { Number: 0.12 } },
      causes: [],
      related: [],
    },
    {
      id: 2,
      kind: 'CollisionRisk',
      severity: 'Error',
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      location: { Waypoint: 7 },
      attributes: { value: { Number: 0.02 } },
      causes: [],
      related: [],
    },
  ],
  actions: [
    {
      id: 10,
      kind: 'adjust_waypoint',
      target_observation: 1,
      priority: 'high',
      impact: 'raises manipulability',
      parameters: {},
    },
    {
      id: 11,
      kind: 'joint_centering',
      target_observation: 2,
      priority: 'high',
      impact: 'clears collision',
      parameters: {},
    },
  ],
  metrics: { duration: 0.42, waypoint_count: 8 },
  summary: {
    quality_index: 0.6,
    score: 71,
    grade: 'Fair',
    observation_count: 2,
    severity_distribution: { Error: 1, Warning: 1 },
  },
}

/** Second fixture — different code paths: Info severity, Timestamp location. */
const infoReport: AnalysisReportWire = {
  ...fullReport,
  observations: [
    {
      id: 5,
      kind: 'TrackingDeviation',
      severity: 'Info',
      artifact: { kind: 'MotionPlan', id: 'plan-1' },
      location: { Timestamp: 2 },
      attributes: {},
      causes: [],
      related: [],
    },
  ],
  actions: [{ id: 20, kind: 'retime', target_observation: 5, priority: 'medium', impact: 'reduces deviation', parameters: {} }],
  summary: {
    quality_index: 0.9,
    score: 55,
    grade: 'Poor',
    observation_count: 1,
    severity_distribution: { Info: 1 },
  },
}

afterEach(() => cleanup())

describe('AdvisorSection — pure AnalysisReport projection (S4b)', () => {
  it('renders a placeholder for a null report without crashing', () => {
    render(<AdvisorSection report={null} />)
    expect(screen.getByText('No analysis available')).toBeInTheDocument()
  })

  it('projects the summary header: score, grade, severity distribution', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.getByText('Score: 71')).toBeInTheDocument()
    expect(screen.getByText('Grade: Fair')).toBeInTheDocument()
    expect(screen.getByText('Errors: 1')).toBeInTheDocument()
    expect(screen.getByText('Warnings: 1')).toBeInTheDocument()
    expect(screen.getByText('Info: 0')).toBeInTheDocument()
  })

  it('lists observations by kind + severity badge + location', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.getByText('Low Manipulability')).toBeInTheDocument()
    expect(screen.getByText('Collision Risk')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('wp3')).toBeInTheDocument()
    expect(screen.getByText('wp7')).toBeInTheDocument()
  })

  it('lists actions by kind + target observation', () => {
    render(<AdvisorSection report={fullReport} />)
    expect(screen.getByText('Adjust Waypoint')).toBeInTheDocument()
    expect(screen.getByText('Joint Centering')).toBeInTheDocument()
    expect(screen.getByText('target observation 1')).toBeInTheDocument()
    expect(screen.getByText('target observation 2')).toBeInTheDocument()
  })

  it('triangulates: Info severity + Timestamp location render structurally', () => {
    render(<AdvisorSection report={infoReport} />)
    expect(screen.getByText('Score: 55')).toBeInTheDocument()
    expect(screen.getByText('Grade: Poor')).toBeInTheDocument()
    expect(screen.getByText('Tracking Deviation')).toBeInTheDocument()
    expect(screen.getByText('Info')).toBeInTheDocument()
    expect(screen.getByText('Timestamp')).toBeInTheDocument()
    expect(screen.getByText('Retime')).toBeInTheDocument()
    expect(screen.getByText('target observation 5')).toBeInTheDocument()
  })
})
