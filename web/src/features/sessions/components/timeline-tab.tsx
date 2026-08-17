import { useQuery } from '@tanstack/react-query'
import { EChart, timelineBuilder } from '@/shared/charts'
import { sessionApi } from '../api/session-api'

/**
 * TimelineTab — session event timeline (S6.3, spec session-timeline).
 *
 * Purely compositional (P4): the tab fetches the canonical ExecutionTrace and
 * delegates ALL domain mapping to timelineBuilder — one marker per canonical
 * event, colors by type, empty state from `events = []`. It never infers
 * events from samples and never streams (post-hoc session-level only).
 */

interface TimelineTabProps {
  sessionId: number
}

export function TimelineTab({ sessionId }: TimelineTabProps) {
  const trace = useQuery({
    queryKey: ['sessions', sessionId, 'execution-trace'],
    queryFn: () => sessionApi.executionTrace(sessionId),
  })

  if (trace.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading timeline…</p>
  }

  if (trace.error) {
    return (
      <p className="text-sm text-destructive">
        {trace.error instanceof Error ? trace.error.message : 'Could not load timeline'}
      </p>
    )
  }

  const data = trace.data
  if (!data) return null

  return (
    <div className="h-80 w-full">
      <EChart model={timelineBuilder(data)} />
    </div>
  )
}
