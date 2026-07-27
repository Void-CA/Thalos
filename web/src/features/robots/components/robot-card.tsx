import type { RobotMetadataDto } from '../api/robot-api.types'
import { cn } from '@/lib/utils'

interface RobotCardProps {
  robot: RobotMetadataDto
  selected: boolean
  onSelect: () => void
}

export function RobotCard({ robot, selected, onSelect }: RobotCardProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-all duration-100',
        'hover:bg-accent/50',
        selected
          ? 'border-primary/40 bg-accent/30 shadow-sm'
          : 'border-transparent bg-muted/30',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{robot.display_name}</span>
        <span className="text-xs text-muted-foreground shrink-0 font-mono">
          {robot.dof} DOF
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {robot.joints.slice(0, 6).map(j => (
          <span
            key={j.name}
            className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-20"
          >
            {j.name}
          </span>
        ))}
        {robot.joints.length > 6 && (
          <span className="text-[10px] px-1.5 py-0.5 text-muted-foreground">
            +{robot.joints.length - 6}
          </span>
        )}
      </div>
    </button>
  )
}
