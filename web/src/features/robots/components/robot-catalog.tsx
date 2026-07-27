import { useRobots } from '../api/use-robots'
import { useRobotStore, useSelectedRobot } from '../store'
import { RobotCard } from './robot-card'
import { Loader2, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react'
import { useState } from 'react'

const CANONICAL_ROBOTS = ['ur5', 'ur5e', 'ur10', 'ur10e', 'scara', 'kr6']

export function RobotCatalog() {
  const { isLoading, error } = useRobots()
  const robots = useRobotStore(s => s.robots)
  const selectedId = useRobotStore(s => s.selectedId)
  const select = useRobotStore(s => s.select)
  const selectedRobot = useSelectedRobot()
  const [canonicalOpen, setCanonicalOpen] = useState(true)

  const canonicalRobots = robots.filter(r => CANONICAL_ROBOTS.includes(r.id.toLowerCase()))
  const otherRobots = robots.filter(r => !CANONICAL_ROBOTS.includes(r.id.toLowerCase()))

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{String(error)}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Canonical Models — collapsible */}
      {canonicalRobots.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setCanonicalOpen(!canonicalOpen)}
            className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs font-semibold uppercase
                       tracking-wider text-muted-foreground bg-secondary/30 hover:bg-secondary/60
                       transition-colors cursor-pointer"
          >
            {canonicalOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Canonical Models
            <span className="ml-auto text-[10px] font-normal opacity-60">{canonicalRobots.length}</span>
          </button>
          {canonicalOpen && (
            <div className="p-1.5 flex flex-col gap-1">
              {canonicalRobots.map(robot => (
                <RobotCard
                  key={robot.id}
                  robot={robot}
                  selected={selectedId === robot.id}
                  onSelect={() => select(robot.id)}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Other robots */}
      {otherRobots.length > 0 && (
        <div className="flex flex-col gap-1">
          {otherRobots.map(robot => (
            <RobotCard
              key={robot.id}
              robot={robot}
              selected={selectedId === robot.id}
              onSelect={() => select(robot.id)}
            />
          ))}
        </div>
      )}

      {robots.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground text-center py-8">
          No robots available
        </p>
      )}

      {/* Active robot info */}
      {selectedRobot && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold text-foreground">
              {selectedRobot.display_name}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
              {selectedRobot.dof} DOF
            </span>
          </div>
          <div className="flex flex-col gap-px">
            {selectedRobot.joints.map((j) => (
              <div key={j.name} className="flex justify-between text-[11px] font-mono px-1 py-0.5 rounded hover:bg-secondary/30">
                <span className="text-muted-foreground truncate mr-2">{j.name}</span>
                <span className="text-foreground/70 tabular-nums">0.0000</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
