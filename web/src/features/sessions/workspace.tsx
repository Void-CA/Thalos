import { useQuery } from '@tanstack/react-query'
import { sessionApi } from './api/session-api'

/**
 * SessionsWorkspace — minimal list view (S5, area-sessions spec).
 *
 * Projects `GET /api/v1/sessions` into a metadata list (id, timestamp,
 * robot, program, duration, status) with a loading state and an empty state.
 * Access is guarded by the registry (`requires: ['completed']` — the guard
 * consumes `completed` from WorkflowState, so this workspace is only
 * reachable after a completed execution); the workspace itself stays a pure
 * projection and re-derives nothing (ADR ui-as-domain-projection).
 *
 * Minimal scope: list only. Session detail, trace, replay, export and
 * comparison are deferred to the future session-browser change.
 */
export function SessionsWorkspace() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionApi.list,
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Sesiones
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading sessions…</p>}

        {isError && (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load sessions'}
          </p>
        )}

        {!isLoading && !isError && data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">No sessions yet</p>
        )}

        {!isLoading && !isError && data && data.length > 0 && (
          <ul className="space-y-2">
            {data.map((session) => (
              <li
                key={session.id}
                className="rounded-md border border-border px-3 py-2 text-xs flex flex-col gap-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-foreground">#{session.id}</span>
                  <span className="text-muted-foreground">{session.status}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>{session.started_at ?? '—'}</span>
                  <span>{session.robot_name}</span>
                  <span>{session.plan_id}</span>
                  <span>{session.duration.toFixed(1)}s</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
