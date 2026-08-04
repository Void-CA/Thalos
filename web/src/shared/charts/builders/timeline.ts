/**
 * Session timeline builder — pure function, spec session-timeline.
 *
 * Input: canonical `ExecutionTraceWire` from GET /sessions/{id}/execution-trace
 * (post-hoc, session-level — never live streaming). Output: ChartModel. NO
 * ECharts, NO React, NO DOM (O2).
 *
 * The builder projects ONLY the canonical `events[]` array: one scatter marker
 * per event on a horizontal time axis, positioned by array index with the
 * x-axis category label carrying the temporal position (event type + mm:ss
 * timestamp), colored by event type. It NEVER synthesizes events from
 * `/trace` samples (spec negative scenario) — events come exclusively from the
 * explicit `events[]` array, and `events = []` surfaces the explicit
 * "No events recorded" empty state.
 */

import type { ExecutionEventWire, ExecutionTraceWire } from '@/features/sessions/api/session-api'
import type { ChartModel } from '../types'

/** Extracts the variant key + timestamp of an externally-tagged event. */
function eventVariant(event: ExecutionEventWire): { type: string; timestamp: number } {
  const entries = Object.entries(event) as Array<[string, { timestamp: number }]>
  const [type, payload] = entries[0] ?? ['Unknown', { timestamp: 0 }]
  return { type, timestamp: payload.timestamp }
}

/** Event type → color token (presentation mapping; unknown types fall back to
 *  the neutral palette — events themselves are never invented). */
function eventColor(type: string): string {
  switch (type) {
    case 'WaypointReached':
      return 'chart-1'
    case 'SegmentCompleted':
      return 'chart-2'
    case 'Started':
    case 'Resumed':
      return 'chart-3'
    case 'Paused':
      return 'chart-4'
    case 'Completed':
      return 'severity.good'
    case 'Cancelled':
      return 'severity.warning'
    case 'Error':
      return 'severity.critical'
    default:
      return 'chart-1'
  }
}

/** Machine-readable variant key → display label ("WaypointReached" →
 *  "Waypoint Reached"). Cosmetic only. */
function eventLabel(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Seconds → mm:ss ("65" → "1:05"). Presentation only. */
function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

/**
 * Projects the canonical execution events into a scatter timeline. The number
 * of markers ALWAYS equals the number of events — nothing is added or derived.
 */
export function timelineBuilder(trace: ExecutionTraceWire): ChartModel {
  const events = trace.events
  if (events.length === 0) {
    return { series: [], xAxis: [], empty: { message: 'No events recorded' } }
  }

  const markers = events.map(eventVariant)

  return {
    title: 'Session timeline',
    series: [
      {
        name: 'Events',
        type: 'scatter',
        data: markers.map(() => 0),
        dataColors: markers.map((marker) => eventColor(marker.type)),
      },
    ],
    xAxis: [
      {
        type: 'category',
        categories: markers.map(
          (marker) => `${eventLabel(marker.type)} · ${formatTimestamp(marker.timestamp)}`,
        ),
      },
    ],
    yAxis: [{ type: 'value', min: 0, max: 1, name: 'Event' }],
    tooltip: { trigger: 'item' },
  }
}
