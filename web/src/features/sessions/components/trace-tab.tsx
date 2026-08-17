import { useQuery } from '@tanstack/react-query'
import { EChart, traceBuilder } from '@/shared/charts'
import { sessionApi } from '../api/session-api'

/**
 * TraceTab — multi-series joint position chart (C1 remediation, spec
 * trace-chart).
 *
 * Purely compositional (P4): the tab fetches the canonical MotionTrace from
 * GET /sessions/{id}/trace and delegates ALL domain mapping to traceBuilder —
 * one line series per joint (positions verbatim), X axis = time (mm:ss), empty
 * state from `samples = []`. It never computes RMSE / tracking error (I2) and
 * never feeds the builder anything but the canonical /trace response (I1).
 */

interface TraceTabProps {
  sessionId: number
}

export function TraceTab({ sessionId }: TraceTabProps) {
  const trace = useQuery({
    queryKey: ['sessions', sessionId, 'trace'],
    queryFn: () => sessionApi.trace(sessionId),
  })

  if (trace.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading trace…</p>
  }

  if (trace.error) {
    return (
      <p className="text-sm text-destructive">
        {trace.error instanceof Error ? trace.error.message : 'Could not load trace'}
      </p>
    )
  }

  const data = trace.data
  if (!data) return null

  return (
    <div className="h-80 w-full">
      <EChart model={traceBuilder(data)} />
    </div>
  )
}
