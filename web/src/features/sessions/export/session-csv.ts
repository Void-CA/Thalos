/**
 * Session CSV export (S6.3, session-manager spec "CSV export" — invariant P3).
 *
 * The export is a pure projection of the CANONICAL data: the CSV string
 * produced by GET /sessions/{id}/export (the backend's `MotionTrace::to_csv`)
 * is downloaded VERBATIM. `sessionCsvDownload` is the pure, testable
 * transformation — it only wraps the backend string into a download
 * descriptor and never reorders, reformats or enriches the data.
 * `triggerCsvDownload` is the only imperative piece (Blob + anchor click).
 */

/** The download descriptor — the canonical CSV untouched, plus file metadata. */
export interface SessionCsvDownload {
  filename: string
  /** The backend CSV string, byte-for-byte. */
  content: string
  mimeType: string
}

/** Wraps the canonical CSV into a download descriptor (pure — no enrichment). */
export function sessionCsvDownload(csv: string, sessionId: number): SessionCsvDownload {
  return {
    filename: `session-${sessionId}-trace.csv`,
    content: csv,
    mimeType: 'text/csv;charset=utf-8',
  }
}

/** Triggers a browser download of the descriptor (imperative DOM boundary). */
export function triggerCsvDownload(download: SessionCsvDownload): void {
  const blob = new Blob([download.content], { type: download.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = download.filename
  anchor.click()
  URL.revokeObjectURL(url)
}
