import { useRef, useState } from 'react'
import { useRobots } from '../api/use-robots'
import { useRobotStore, useSelectedRobot } from '../store'
import { useLoadRobotFromUrdf } from '@/features/viewport/synchronization/use-scene-loader'
import { RobotCard } from './robot-card'
import { ErrorBox } from '@/components/ui/error-box'
import { Loader2, ChevronRight, ChevronDown, Upload } from 'lucide-react'

/** IDs de robots a excluir del catálogo. */
const EXCLUDED_IDS = new Set([
  'single_revolute',
  'manipulator_6dof',
  'cylindrical_rpp',
  'spherical_polar_rrp',
])

export function RobotCatalog() {
  const query = useRobots()
  const { isLoading, error, refetch } = query
  const robots = useRobotStore(s => s.robots)
  const selectedId = useRobotStore(s => s.selectedId)
  const select = useRobotStore(s => s.select)
  const selectedRobot = useSelectedRobot()
  const [canonicalOpen, setCanonicalOpen] = useState(true)
  const [urdfOpen, setUrdfOpen] = useState(false)
  const [urdfFileName, setUrdfFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadUrdf = useLoadRobotFromUrdf()

  const displayedRobots = robots.filter(r => !EXCLUDED_IDS.has(r.id.toLowerCase()))

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUrdfFileName(file.name)
    select(null) // deselect any canonical robot

    const reader = new FileReader()
    reader.onload = () => {
      loadUrdf.mutate(reader.result as string)
    }
    reader.readAsText(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3">
        <ErrorBox
          error={error instanceof Error ? error : { message: String(error) }}
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ── Canonical Models ── */}
      {displayedRobots.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setCanonicalOpen(!canonicalOpen)}
            className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs font-semibold uppercase
                       tracking-wider text-muted-foreground bg-secondary/30 hover:bg-secondary/60
                       transition-colors cursor-pointer"
          >
            {canonicalOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Canonical Models
            <span className="ml-auto text-[10px] font-normal opacity-60">{displayedRobots.length}</span>
          </button>
          {canonicalOpen && (
            <div className="p-1.5 flex flex-col gap-1">
              {displayedRobots.map(robot => (
                <RobotCard
                  key={robot.id}
                  robot={robot}
                  selected={selectedId === robot.id}
                  onSelect={() => {
                    setUrdfFileName(null)
                    select(robot.id)
                  }}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Import URDF ── */}
      <div className="rounded-md border border-border overflow-hidden">
        <button
          onClick={() => setUrdfOpen(!urdfOpen)}
          className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs font-semibold uppercase
                     tracking-wider text-muted-foreground bg-secondary/30 hover:bg-secondary/60
                     transition-colors cursor-pointer"
        >
          {urdfOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Import URDF
        </button>
        {urdfOpen && (
          <div className="p-2.5 flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".urdf,.xml"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loadUrdf.isPending}
              className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium
                         rounded-lg border border-dashed border-border bg-transparent
                         text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary/30
                         transition-all cursor-pointer disabled:opacity-40"
            >
              {loadUrdf.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {loadUrdf.isPending ? 'Importing…' : 'Choose file…'}
            </button>
            {urdfFileName && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{urdfFileName}</span>
                {loadUrdf.isSuccess && <span className="text-chart-3 shrink-0">✓ loaded</span>}
              </div>
            )}
            {loadUrdf.error && (
              <div className="text-[11px] text-destructive">
                {(loadUrdf.error as Error).message}
              </div>
            )}
          </div>
        )}
      </div>

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
