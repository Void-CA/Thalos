import { useQuery } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sessionApi, type SessionSummary } from '../api/session-api'
import { ComparisonTab } from './comparison-tab'
import { TimelineTab } from './timeline-tab'
import { ExportTab } from './export-tab'

interface SessionDetailProps {
  /** The selected list row — header context only; numbers come from the detail endpoints. */
  session: SessionSummary
}

/**
 * SessionDetail — detail pane for the selected session (S5 + S6.3,
 * session-browser + session-manager specs).
 *
 * The pane is PURELY COMPOSITIONAL (P4): Summary | Comparison | Timeline |
 * Export tabs. Summary keeps the `/summary` preview + `/statistics` readout
 * (spec "Preview without replay" — it SHALL NOT call `/trace` or `/replay`);
 * the S6 tabs are thin projections that fetch their canonical endpoint on
 * mount (lazy — an inactive tab performs no request) and delegate ALL domain
 * mapping to the S6 builders (`comparisonBuilder`, `timelineBuilder`) and the
 * export helper. No client-side metrics, no event inference, no store.
 */
export function SessionDetail({ session }: SessionDetailProps) {
  const summary = useQuery({
    queryKey: ['sessions', session.id, 'summary'],
    queryFn: () => sessionApi.summary(session.id),
  })
  const statistics = useQuery({
    queryKey: ['sessions', session.id, 'statistics'],
    queryFn: () => sessionApi.statistics(session.id),
  })

  const detailLoading = summary.isLoading || statistics.isLoading
  const detailError = summary.error ?? statistics.error

  if (detailLoading) {
    return <p className="text-sm text-muted-foreground">Loading detail…</p>
  }

  if (detailError) {
    return (
      <p className="text-sm text-destructive">
        {detailError instanceof Error ? detailError.message : 'Could not load session detail'}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Session #{session.id}
        </h3>
        <span className="text-xs text-muted-foreground">
          {session.robot_name} · {session.plan_id}
        </span>
      </header>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="pt-3">
          {summary.data && (
            <section aria-label="Session preview" className="rounded-md border border-border p-3 space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Samples</dt>
                <dd className="text-foreground text-right">{summary.data.sample_count} samples</dd>
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="text-foreground text-right">{summary.data.duration}s</dd>
                <dt className="text-muted-foreground">Joints</dt>
                <dd className="text-foreground text-right">{summary.data.joint_count} joints</dd>
                <dt className="text-muted-foreground">Path length</dt>
                <dd className="text-foreground text-right">{summary.data.path_length}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="text-foreground text-right">{summary.data.recording_source}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-foreground text-right">{summary.data.status}</dd>
              </dl>
            </section>
          )}

          {statistics.data && (
            <section aria-label="Execution statistics" className="rounded-md border border-border p-3 space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Statistics
              </h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Sample rate</dt>
                <dd className="text-foreground text-right">{statistics.data.sample_rate} Hz</dd>
                <dt className="text-muted-foreground">Events</dt>
                <dd className="text-foreground text-right">{statistics.data.event_count}</dd>
                <dt className="text-muted-foreground">Waypoints completed</dt>
                <dd className="text-foreground text-right">{statistics.data.waypoints_completed}</dd>
                <dt className="text-muted-foreground">Max tracking error</dt>
                <dd className="text-foreground text-right">{statistics.data.max_tracking_error}</dd>
                <dt className="text-muted-foreground">Avg tracking error</dt>
                <dd className="text-foreground text-right">{statistics.data.avg_tracking_error}</dd>
              </dl>
            </section>
          )}
        </TabsContent>

        <TabsContent value="comparison" className="pt-3">
          <ComparisonTab sessionId={session.id} />
        </TabsContent>

        <TabsContent value="timeline" className="pt-3">
          <TimelineTab sessionId={session.id} />
        </TabsContent>

        <TabsContent value="export" className="pt-3">
          <ExportTab sessionId={session.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
