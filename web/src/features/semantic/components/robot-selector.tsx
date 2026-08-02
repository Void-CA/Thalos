import { useEffect, useState } from 'react'
import { Loader2, Cpu } from 'lucide-react'
import { useRobots } from '@/features/robots/api/use-robots'
import { useRobotStore } from '@/features/robots/store'
import type { RobotMetadataDto } from '@/features/robots/api/robot-api.types'

/** localStorage key persisting the Task workspace robot selection. */
export const ROBOT_SELECTION_KEY = 'thalos:task:robotId'

/** Default robot for the Task workspace (SCARA — matches the seeded scene). */
export const DEFAULT_ROBOT_ID = 'scara'

const FALLBACK_ROBOTS: RobotMetadataDto[] = [
  { id: DEFAULT_ROBOT_ID, display_name: 'SCARA', dof: 4, joints: [] },
]

/**
 * Robot selector for the Task workspace.
 *
 * Populates the catalog via `useRobots` (the RobotCatalog only renders in the
 * Robot perspective, so the Task sidebar loads it on its own). The selection is
 * persisted to localStorage and written to `useRobotStore.selectedId`; the
 * AppShell `useSceneRobotSync` hook reacts to that selection and loads the
 * robot into the scene through `useLoadRobot` — the same load path the Robot
 * perspective uses. No local `useLoadRobot` call, so a selection change never
 * double-loads.
 */
export function RobotSelector() {
  const { isLoading } = useRobots()
  const robots = useRobotStore((s) => s.robots)
  const selectedId = useRobotStore((s) => s.selectedId)
  const select = useRobotStore((s) => s.select)

  // Selection restored from localStorage (or default SCARA); materialized once
  // the catalog is known, because `select` ignores unknown ids.
  const [pendingId, setPendingId] = useState<string | null>(() => {
    const persisted = localStorage.getItem(ROBOT_SELECTION_KEY)
    return persisted ?? DEFAULT_ROBOT_ID
  })

  useEffect(() => {
    if (robots.length === 0 || pendingId === null) return
    const id = robots.some((r) => r.id === pendingId) ? pendingId : DEFAULT_ROBOT_ID
    localStorage.setItem(ROBOT_SELECTION_KEY, id)
    select(id)
    setPendingId(null)
  }, [robots, pendingId, select])

  const options: RobotMetadataDto[] = robots.length > 0 ? robots : FALLBACK_ROBOTS
  const value = selectedId ?? pendingId ?? DEFAULT_ROBOT_ID

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    localStorage.setItem(ROBOT_SELECTION_KEY, id)
    select(id)
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
