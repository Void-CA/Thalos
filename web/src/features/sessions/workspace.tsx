import { SessionBrowser } from './components/SessionBrowser'

/**
 * SessionsWorkspace — Sessions area entry point (S5, area-sessions spec).
 *
 * Renders the full session browser (list + status filters + search +
 * detail preview). Pure projection over React Query (ADR
 * ui-as-domain-projection, invariant I4): the area has NO parallel session
 * store — all state derives from the canonical session endpoints.
 * Access is ungated since S5 (guard relaxed — failed/running sessions are
 * browsable).
 */
export function SessionsWorkspace() {
  return <SessionBrowser />
}
