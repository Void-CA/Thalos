import { describe, it, expect } from 'vitest'
import { timelineBuilder } from './timeline'
import type { ExecutionTraceWire } from '@/features/sessions/api/session-api'

/**
 * S6.2 — timelineBuilder (spec session-timeline).
 *
 * The timeline projects the CANONICAL `ExecutionTrace.events[]` into one
 * scatter marker per event: temporal position as the x-axis category label
 * (type + mm:ss timestamp), color by event type, and an explicit empty state
 * when `events = []`. It MUST NOT synthesize events from `/trace` samples —
 * the builder only ever sees `ExecutionTraceWire`, which carries no sample
 * inference path (negative scenario pinned below).
 */

function trace(events: ExecutionTraceWire['events']): ExecutionTraceWire {
  return { metadata: {}, samples: [], events }
}

describe('timelineBuilder — one marker per canonical event (spec event timeline)', () => {
  it('projects each event as a scatter marker labeled with type and timestamp', () => {
    const model = timelineBuilder(
      trace([
        { Started: { timestamp: 0 } },
        { WaypointReached: { timestamp: 3, waypoint: 1 } },
        { WaypointReached: { timestamp: 6, waypoint: 2 } },
        { Completed: { timestamp: 10 } },
      ]),
    )

    expect(model.empty).toBeUndefined()
    expect(model.series).toHaveLength(1)
    expect(model.series[0].type).toBe('scatter')
    expect(model.series[0].data).toHaveLength(4)
    expect(model.xAxis[0].type).toBe('category')
    expect(model.xAxis[0].categories).toEqual([
      'Started · 0:00',
      'Waypoint Reached · 0:03',
      'Waypoint Reached · 0:06',
      'Completed · 0:10',
    ])
  })

  it('colors markers by event type (same type → same token, distinct types differ)', () => {
    const model = timelineBuilder(
      trace([
        { Started: { timestamp: 0 } },
        { WaypointReached: { timestamp: 3, waypoint: 1 } },
        { WaypointReached: { timestamp: 6, waypoint: 2 } },
        { Completed: { timestamp: 10 } },
      ]),
    )

    const colors = model.series[0].dataColors
    expect(colors).toHaveLength(4)
    expect(colors![1]).toBe(colors![2]) // both WaypointReached
    expect(colors![0]).not.toBe(colors![1]) // Started differs
    expect(colors![3]).not.toBe(colors![1]) // Completed differs
  })

  it('renders "No events recorded" when events is empty', () => {
    const model = timelineBuilder(trace([]))

    expect(model.empty?.message).toBe('No events recorded')
    expect(model.series).toEqual([])
  })

  it('NEVER infers events from trace samples — samples alone produce no markers', () => {
    // A trace with samples but no events must render NO markers: events come
    // exclusively from the explicit events[] array (spec negative scenario).
    const model = timelineBuilder({
      metadata: {},
      samples: [{ timestamp: 0 }, { timestamp: 1 }, { timestamp: 2 }],
      events: [],
    })

    expect(model.empty?.message).toBe('No events recorded')
    expect(model.series).toEqual([])
  })

  it('triangulates: minutes format and Error events project with their own label/color', () => {
    const model = timelineBuilder(
      trace([
        { Error: { timestamp: 65, message: 'joint 2 velocity limit' } },
        { SegmentCompleted: { timestamp: 70, segment: 3 } },
        { Cancelled: { timestamp: 71 } },
      ]),
    )

    expect(model.xAxis[0].categories).toEqual([
      'Error · 1:05',
      'Segment Completed · 1:10',
      'Cancelled · 1:11',
    ])
    const colors = model.series[0].dataColors!
    expect(colors[0]).toBe('severity.critical') // Error
    expect(colors[1]).toBe('chart-2') // SegmentCompleted
    expect(colors[2]).toBe('severity.warning') // Cancelled
  })
})
