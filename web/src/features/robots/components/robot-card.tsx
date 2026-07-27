import type { RobotMetadataDto } from '../api/robot-api.types'
import { cn } from '@/lib/utils'

interface RobotCardProps {
  robot: RobotMetadataDto
  selected: boolean
  onSelect: () => void
  compact?: boolean
}

export function RobotCard({ robot, selected, onSelect, compact }: RobotCardProps) {
  if (compact) {
    return (
      <button
        onClick={onSelect}
        className={cn(
          'w-full text-left px-2.5 py-1.5 rounded-md border transition-all duration-100',
          'hover:bg-accent/40',
          selected
            ? 'border-primary-mid bg-primary-weak'
            : 'border-transparent',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{robot.display_name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0 font-mono tabular-nums">
            {robot.dof} DOF
          </span>
        </div>
      </button>
    )
  }

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left p-2.5 rounded-lg border transition-all duration-100',
        'hover:bg-accent/40',
        selected
          ? 'border-primary-mid bg-primary-weak shadow-sm'
          : 'border-transparent bg-card/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{robot.display_name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 font-mono tabular-nums">
          {robot.dof} DOF
        </span>
      </div>
      {robot.joints.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {robot.joints.slice(0, 6).map(j => (
            <span
              key={j.name}
              className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground truncate max-w-20"
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
      )}
    </button>
  )
}
