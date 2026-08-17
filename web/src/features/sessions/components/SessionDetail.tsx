import { useQuery } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sessionApi, type SessionSummary } from '../api/session-api'
import { ComparisonTab } from './comparison-tab'
import { TimelineTab } from './timeline-tab'
import { TraceTab } from './trace-tab'
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
        <TabsList className="mx-3 mt-3 shrink-0">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="comparison">Comparison</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="pt-3">
          {summary.data && (
            <section aria-label="Session preview" className="rounded-md border border-border p-3 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </h4>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Samples</dt>
                  <dd className="text-xl font-semibold text-foreground">{summary.data.sample_count} samples</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Duration</dt>
                  <dd className="text-xl font-semibold text-foreground">{summary.data.duration}s</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Joints</dt>
                  <dd className="text-xl font-semibold text-foreground">{summary.data.joint_count} joints</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Path length</dt>
                  <dd className="text-xl font-semibold text-foreground">{summary.data.path_length}</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Source</dt>
                  <dd className="text-xl font-semibold text-foreground">{summary.data.recording_source}</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Status</dt>
                  <dd className="text-xl font-semibold text-foreground">{summary.data.status}</dd>
                </div>
              </dl>
            </section>
          )}

          {statistics.data && (
            <section aria-label="Execution statistics" className="rounded-md border border-border p-3 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Statistics
              </h4>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Sample rate</dt>
                  <dd className="text-xl font-semibold text-foreground">{statistics.data.sample_rate} Hz</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Events</dt>
                  <dd className="text-xl font-semibold text-foreground">{statistics.data.event_count}</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Waypoints completed</dt>
                  <dd className="text-xl font-semibold text-foreground">{statistics.data.waypoints_completed}</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Max tracking error</dt>
                  <dd className="text-xl font-semibold text-foreground">{statistics.data.max_tracking_error}</dd>
                </div>
                <div className="rounded-md border border-border bg-secondary/20 px-3 py-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">Avg tracking error</dt>
                  <dd className="text-xl font-semibold text-foreground">{statistics.data.avg_tracking_error}</dd>
                </div>
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

        <TabsContent value="trace" className="pt-3">
          <TraceTab sessionId={session.id} />
        </TabsContent>

        <TabsContent value="export" className="pt-3">
          <ExportTab sessionId={session.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
