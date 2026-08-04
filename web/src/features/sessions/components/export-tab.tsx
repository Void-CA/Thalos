import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { sessionApi } from '../api/session-api'
import { sessionCsvDownload, triggerCsvDownload } from '../export/session-csv'

/**
 * ExportTab — raw trace CSV export (S6.3, session-manager spec "CSV export").
 *
 * Purely compositional (P4): the tab fetches the canonical CSV string from
 * GET /sessions/{id}/export and downloads it VERBATIM — the pure
 * `sessionCsvDownload` wrapper adds only file metadata, never enrichment or
 * reinterpretation of the domain data (P3).
 */

interface ExportTabProps {
  sessionId: number
}

export function ExportTab({ sessionId }: ExportTabProps) {
  const csv = useQuery({
    queryKey: ['sessions', sessionId, 'export'],
    queryFn: () => sessionApi.exportCsv(sessionId),
  })

  if (csv.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading export…</p>
  }

  if (csv.error) {
    return (
      <p className="text-sm text-destructive">
        {csv.error instanceof Error ? csv.error.message : 'Could not load export'}
      </p>
    )
  }

  const content = csv.data
  if (content === undefined) return null

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Raw trace CSV from <code className="font-mono">GET /sessions/{sessionId}/export</code> —
        downloaded verbatim, no client-side processing.
      </p>
      <button
        type="button"
        onClick={() => triggerCsvDownload(sessionCsvDownload(content, sessionId))}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/50"
      >
        <Download className="size-3.5" />
        Export CSV
      </button>
    </div>
  )
}
