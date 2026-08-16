// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { colorForWaypoint } from './trajectory'
import { SEVERITY, MANIP_HIGH, MANIP_MED, MANIP_LOW, SINGULAR_SINGULAR, SINGULAR_NEAR, SINGULAR_NORMAL } from '@/shared/tokens'
import type { WaypointAnalysisView } from '@/shared/contracts/analysis-report'

type Wp = Pick<WaypointAnalysisView, 'severity' | 'manipulability' | 'singularity_state'>

const wp = (over: Partial<Wp> & Pick<WaypointAnalysisView, 'severity'>): Wp => ({
  manipulability: null,
  singularity_state: null,
  ...over,
})

/**
 * Trajectory color modes (viewport trajectory coloring):
 * - 'trajectory-quality' colors by observation severity.
 * - 'manipulability' colors by the normalized yoshikawa thresholds.
 * - 'singularity' colors by the singularity state.
 * PURE rule tests — no DOM/WebGL.
 */
describe('colorForWaypoint — per-waypoint color mapping (non-segment modes)', () => {
  it('trajectory-quality maps severity to SEVERITY tokens', () => {
    expect(colorForWaypoint(wp({ severity: 'good' }), 'trajectory-quality')).toBe(SEVERITY.good)
    expect(colorForWaypoint(wp({ severity: 'warning' }), 'trajectory-quality')).toBe(SEVERITY.warning)
    expect(colorForWaypoint(wp({ severity: 'critical' }), 'trajectory-quality')).toBe(SEVERITY.critical)
  })

  it('manipulability maps normalized thresholds to high/med/low', () => {
    expect(colorForWaypoint(wp({ severity: 'good', manipulability: 0.7 }), 'manipulability')).toBe(MANIP_HIGH)
    expect(colorForWaypoint(wp({ severity: 'good', manipulability: 0.4 }), 'manipulability')).toBe(MANIP_MED)
    expect(colorForWaypoint(wp({ severity: 'good', manipulability: 0.1 }), 'manipulability')).toBe(MANIP_LOW)
  })

  it('manipulability returns null (not nodata) when the value is absent', () => {
    expect(colorForWaypoint(wp({ severity: 'good' }), 'manipulability')).toBeNull()
  })

  it('singularity maps states to SINGULAR tokens and null when unknown', () => {
    expect(colorForWaypoint(wp({ severity: 'warning', singularity_state: 'singular' }), 'singularity')).toBe(SINGULAR_SINGULAR)
    expect(colorForWaypoint(wp({ severity: 'warning', singularity_state: 'near' }), 'singularity')).toBe(SINGULAR_NEAR)
    expect(colorForWaypoint(wp({ severity: 'warning', singularity_state: 'normal' }), 'singularity')).toBe(SINGULAR_NORMAL)
    expect(colorForWaypoint(wp({ severity: 'warning' }), 'singularity')).toBeNull()
  })

  it('returns null for unknown modes (caller falls back to nodata)', () => {
    expect(colorForWaypoint(wp({ severity: 'good' }), 'segment')).toBeNull()
    expect(colorForWaypoint(wp({ severity: 'good' }), 'nope')).toBeNull()
  })
})