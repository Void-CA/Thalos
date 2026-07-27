import { usePerspectiveStore } from './perspective-store'
import { Button } from '@/components/ui/button'

const PERSPECTIVE_LABELS: Record<string, string> = {
  robot: 'Robot',
  planning: 'Planning',
  analysis: 'Analysis',
  execution: 'Execution',
  knowledge: 'Knowledge',
  sessions: 'Sessions',
}

export function TopBar() {
  const perspective = usePerspectiveStore(s => s.perspective)
  const setPerspective = usePerspectiveStore(s => s.setPerspective)
  return (
    <header className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-sidebar shrink-0">
      {/* Logo / Name */}
      <span className="font-bold text-sm tracking-tight mr-4">
        Thalos
      </span>

      {/* Perspective buttons */}
      <div className="flex items-center gap-0.5">
        {Object.entries(PERSPECTIVE_LABELS).map(([key, label]) => (
          <Button
            key={key}
            variant={perspective === key ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setPerspective(key as any)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Placeholder for future widgets */}
        <span className="text-xs text-muted-foreground">v0.1.0</span>
      </div>
    </header>
  )
}
