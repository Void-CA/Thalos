import { useEffect, useMemo, useState } from 'react'
import { Loader2, Cpu } from 'lucide-react'
import { useRobots } from '@/features/robots/api/use-robots'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '@/features/viewport/store'
import type { RobotMetadataDto } from '@/features/robots/api/robot-api.types'

/** localStorage key persisting the Task workspace robot REQUEST hint (spec R6 — non-authoritative). */
export const ROBOT_SELECTION_KEY = 'thalos:task:robotId'

/**
 * Robot selector for the Task workspace — READER + REQUESTER (design D6/D8).
 *
 * The DISPLAYED value is the CONFIRMED identity from the scene runtime
 * (`runtime.robot.id`, written only by applyScene — single writer, spec R2).
 * Catalog `select(id)` is a REQUEST: AppShell's useSceneRobotSync turns it into
 * a backend load via useLoadRobot, and the display changes only once applyScene
 * confirms (spec R5).
 *
 * localStorage (R6): persisted catalog ids are hints, requested on mount.
 * URDF ids (`urdf:*`) are NEVER persisted nor requested through select() —
 * they are scene state; persisting them would reload them as catalog robots.
 */
export function RobotSelector() {
  const { isLoading } = useRobots()
  const robots = useRobotStore((s) => s.robots)
  const select = useRobotStore((s) => s.select)

  // Confirmed identity — single writer: applyScene (spec R2, R5.1).
  const runtimeRobot = useSceneStore((s) => s.runtime?.robot ?? null)

  // Persisted hint, restored once. Materialized as a REQUEST once the catalog
  // is known; select() ignores unknown ids → backend default wins (spec R6).
  const [pendingId, setPendingId] = useState<string | null>(() =>
    localStorage.getItem(ROBOT_SELECTION_KEY),
  )

  useEffect(() => {
    if (robots.length === 0 || pendingId === null) return
    if (robots.some((r) => r.id === pendingId)) {
      select(pendingId) // request — the scene confirms or overrides via applyScene
    }
    // Unknown persisted ids (incl. stale urdf:*) are intentionally ignored.
    setPendingId(null)
  }, [robots, pendingId, select])

  // Options = catalog + the current non-catalog (URDF) identity so the <select>
  // can DISPLAY a confirmed URDF robot (spec R5.1).
  const options: RobotMetadataDto[] = useMemo(() => {
    const catalog = robots.length > 0 ? robots : []
    if (runtimeRobot && !catalog.some((r) => r.id === runtimeRobot.id)) {
      return [...catalog, runtimeRobot]
    }
    return catalog
  }, [robots, runtimeRobot])

  const value = runtimeRobot?.id ?? ''

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    if (id === runtimeRobot?.id) return // no-op: same confirmed identity
    if (robots.some((r) => r.id === id)) {
      // Catalog id → persist hint + request load (design D6/D8).
      localStorage.setItem(ROBOT_SELECTION_KEY, id)
      select(id)
    }
    // Non-catalog (urdf:*) values are display-only; never requested nor persisted.
  }

  return (
    <div className="flex items-center gap-2">
      <Cpu className="size-3.5 text-muted-foreground shrink-0" />
      <select
        value={value}
        onChange={handleChange}
        disabled={isLoading && robots.length === 0}
        aria-label="Task robot"
        className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-border bg-background
                   text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
      >
        {value === '' && (
          <option value="" disabled>
            {isLoading ? 'Loading…' : 'No robot'}
          </option>
        )}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.display_name}
          </option>
        ))}
      </select>
      {isLoading && robots.length === 0 && (
        <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
      )}
    </div>
  )
}
