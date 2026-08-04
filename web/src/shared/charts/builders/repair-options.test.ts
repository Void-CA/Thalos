import { describe, it, expect } from 'vitest'
import type { RepairOptionWire, RepairOptionsWire } from '@/shared/contracts/repair-options'
import { repairOptionsBuilder } from './repair-options'

/**
 * S4 — repairOptionsBuilder (spec alternatives-panel-react).
 *
 * Pure builder: canonical `RepairOptionsWire` (/plan/repair/options) → card
 * presentation model (design P2/P7, criterion C3). The component is a PURE
 * CONSUMER: every presentation transformation (kebab-case → display label,
 * improvement fraction → percent label, metric decimals) lives here, never in
 * the panel.
 *
 * Empty state derives from the DOMAIN (C4): `repairs = []` is the backend
 * saying the plan has no repair options — the builder surfaces
 * `empty.message` the same way ChartModel.empty does for charts.
 */

function option(overrides: Partial<RepairOptionWire> = {}): RepairOptionWire {
  return {
    region_id: 1,
    strategy: 'lift-tcp',
    status: 'available',
    improvement: 0.15,
    metrics_before: { manipulability: 0.2146, smoothness: 0.8 },
    metrics_after: { manipulability: 0.3614, smoothness: 0.9 },
    ...overrides,
  }
}

function response(repairs: RepairOptionWire[]): RepairOptionsWire {
  return { repairs }
}

describe('repairOptionsBuilder — canonical /plan/repair/options → presentation (S4)', () => {
  it('maps every repair to a card with region, strategy label, status, improvement and metrics (spec "Options rendered")', () => {
    const model = repairOptionsBuilder(
      response([
        option(),
        option({ region_id: 2, strategy: 'rotate-tool', improvement: 0.08 }),
        option({ region_id: 3, strategy: 'split-segment', improvement: -0.05 }),
      ]),
    )

    expect(model.empty).toBeNull()
    expect(model.options).toHaveLength(3)
    expect(model.options[0]).toEqual({
      regionId: 1,
      strategy: 'Lift Tcp',
      status: 'available',
      improvement: 0.15,
      improvementLabel: '+15.0%',
      metricsBefore: { manipulability: '0.215', smoothness: '0.800' },
      metricsAfter: { manipulability: '0.361', smoothness: '0.900' },
    })
    // Every strategy renders its own label + the verbatim sign of the delta.
    expect(model.options[1]).toMatchObject({ regionId: 2, strategy: 'Rotate Tool' })
    expect(model.options[2]).toMatchObject({
      strategy: 'Split Segment',
      improvementLabel: '-5.0%',
    })
  })

  it('derives the empty state from the domain when repairs is empty (spec "Empty options")', () => {
    const model = repairOptionsBuilder(response([]))

    expect(model.options).toHaveLength(0)
    expect(model.empty?.message).toBe('No alternatives available')
  })

  it('preserves absent metric summaries as null instead of inventing values', () => {
    const model = repairOptionsBuilder(
      response([option({ metrics_before: null, metrics_after: null })]),
    )

    expect(model.options).toHaveLength(1)
    expect(model.options[0].metricsBefore).toBeNull()
    expect(model.options[0].metricsAfter).toBeNull()
  })

  it('labels a zero improvement without treating it as missing', () => {
    const model = repairOptionsBuilder(response([option({ improvement: 0 })]))
    expect(model.options[0].improvementLabel).toBe('+0.0%')
  })
})
