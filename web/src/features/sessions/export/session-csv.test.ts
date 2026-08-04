import { describe, it, expect } from 'vitest'
import { sessionCsvDownload } from './session-csv'

/**
 * S6.3 — session CSV export (session-manager spec "CSV export", P3).
 *
 * The export is a pure projection: the browser downloads the canonical CSV
 * string produced by GET /sessions/{id}/export (the backend's `MotionTrace`
 * serialization) VERBATIM. The pure function only wraps that string into a
 * download descriptor — it never reorders, reformats or enriches the data.
 * These tests pin the byte-for-byte passthrough: if the export ever added or
 * recomputed columns, `content` would diverge from the input.
 */

describe('sessionCsvDownload — canonical CSV passthrough, no enrichment', () => {
  it('passes the backend CSV through byte-for-byte with a session-scoped filename', () => {
    const csv =
      'timestamp_s,joint_0,joint_1,progress\n' +
      '0.000000,0.000000,0.000000,0.0000\n' +
      '1.000000,1.000000,0.500000,0.2500\n'

    const download = sessionCsvDownload(csv, 7)

    expect(download.content).toBe(csv)
    expect(download.filename).toBe('session-7-trace.csv')
    expect(download.mimeType).toBe('text/csv;charset=utf-8')
  })

  it('keeps an empty CSV intact — never fabricates a header or rows', () => {
    const download = sessionCsvDownload('', 2)

    expect(download.content).toBe('')
    expect(download.filename).toBe('session-2-trace.csv')
  })

  it('triangulates: a different payload and session id project verbatim', () => {
    const csv = 'timestamp_s,joint_0,progress\n0.000000,0.100000,0.0000\n'

    const download = sessionCsvDownload(csv, 41)

    expect(download.content).toBe(csv)
    expect(download.filename).toBe('session-41-trace.csv')
  })
})
