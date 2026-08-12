import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { sessionApi } from '../api/session-api'
import { SessionDetail } from './SessionDetail'

/** Status filter options (session-browser spec: multi-select of Completed,
 *  Failed, Running, All). Backend statuses are the Debug strings of
 *  SessionStatus (Ready/Running/Paused/Completed/Cancelled/Failed) — the
 *  browser filters exactly the spec set; everything else appears under All. */
const STATUS_FILTERS = ['Completed', 'Failed', 'Running'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

/**
 * SessionBrowser — master-detail session browser (S5, session-browser spec).
 *
 * Data flow (invariant I4 / C2): `GET /sessions` → React Query cache →
 * component. The browser consumes the query DIRECTLY — there is no Zustand
 * store for sessions and no parallel client model.
 *
 * - Filters and search are PRESENTATION-ONLY transformations (C3/I2) over the
 *   cached list: sessions are never enriched with client-side fields.
 * - Loading / error / empty states derive from the endpoint query (C4).
 * - Selecting a row mounts SessionDetail, whose preview comes from `/summary`
 *   (spec "Preview without replay" — never `/trace` or `/replay`).
 */
export function SessionBrowser() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionApi.list,
  })

  const [statusFilter, setStatusFilter] = useState<ReadonlySet<StatusFilter>>(new Set())
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Presentation-only filtering over the cached endpoint list (C3).
  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.filter((s) => {
      const statusOk = statusFilter.size === 0 || statusFilter.has(s.status as StatusFilter)
      const searchOk =
        q === '' ||
        s.plan_id.toLowerCase().includes(q) ||
        s.robot_name.toLowerCase().includes(q)
      return statusOk && searchOk
    })
  }, [data, search, statusFilter])

  const selected = data?.find((s) => s.id === selectedId) ?? null

  function toggleStatus(status: StatusFilter) {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Sessions
        </h2>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Master — filter controls + session list */}
        <div className="w-72 shrink-0 border-r border-border flex flex-col">
          <div className="p-3 space-y-2 border-b border-border">
            <div role="group" aria-label="Status filter" className="flex flex-wrap gap-1">
              <button
                type="button"
                aria-pressed={statusFilter.size === 0}
                onClick={() => setStatusFilter(new Set())}
                className="rounded-md border border-border px-2 py-1 text-[11px] aria-pressed:bg-primary-weak aria-pressed:text-primary"
              >
                All
              </button>
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter.has(status)}
                  onClick={() => toggleStatus(status)}
                  className="rounded-md border border-border px-2 py-1 text-[11px] aria-pressed:bg-primary-weak aria-pressed:text-primary"
                >
                  {status}
                </button>
              ))}
            </div>
            <label className="relative block">
              <span className="sr-only">Search sessions</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label="Search sessions"
                placeholder="Search plan or robot…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border bg-transparent pl-7 pr-2 py-1 text-xs"
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading sessions…</p>}

            {isError && (
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : 'Could not load sessions'}
              </p>
            )}

            {!isLoading && !isError && data && data.length === 0 && (
              <p className="text-sm text-muted-foreground">No sessions yet</p>
            )}

            {!isLoading && !isError && data && data.length > 0 && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">No sessions match the current filters</p>
            )}

            {filtered.length > 0 && (
              <ul className="space-y-1.5">
                {filtered.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      aria-pressed={selectedId === session.id}
                      onClick={() => setSelectedId(session.id)}
                      className="w-full rounded-md border border-border px-3 py-2 text-xs flex flex-col gap-1 text-left aria-pressed:border-primary"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-foreground">#{session.id}</span>
                        <span className="text-muted-foreground">{session.status}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                        <span>{session.plan_id}</span>
                        <span>{session.robot_name}</span>
                        <span>{session.duration.toFixed(1)}s</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Detail — preview from canonical endpoints (summary + statistics) */}
        <div className="flex-1 overflow-y-auto p-4">
          {selected ? (
            <SessionDetail session={selected} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a session to inspect its detail
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
