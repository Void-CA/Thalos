import { useRobots } from '../api/use-robots'
import { useRobotStore, useSelectedRobot } from '../store'
import { RobotCard } from './robot-card'
import { Loader2, AlertCircle } from 'lucide-react'

export function RobotCatalog() {
  const { isLoading, error } = useRobots()
  const robots = useRobotStore(s => s.robots)
  const selectedId = useRobotStore(s => s.selectedId)
  const select = useRobotStore(s => s.select)
  const selectedRobot = useSelectedRobot()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 p-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{String(error)}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {robots.map(robot => (
        <RobotCard
          key={robot.id}
          robot={robot}
          selected={selectedId === robot.id}
          onSelect={() => select(robot.id)}
        />
      ))}

      {robots.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No robots available
        </p>
      )}

      {/* Active robot info */}
      {selectedRobot && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {selectedRobot.display_name}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {selectedRobot.dof} DOF
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {selectedRobot.joints.map((j) => (
              <div key={j.name} className="flex justify-between text-xs font-mono">
                <span className="text-muted-foreground truncate mr-2">{j.name}</span>
                <span className="text-foreground/80">0.0000</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
