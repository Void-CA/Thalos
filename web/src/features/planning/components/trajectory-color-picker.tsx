import { useSceneStore, type TrajectoryColorMode } from '@/features/viewport/store'

const MODES: { key: TrajectoryColorMode; label: string }[] = [
  { key: 'segment', label: 'Segment' },
  { key: 'trajectory-quality', label: 'Quality' },
  { key: 'manipulability', label: 'Manipulability' },
  { key: 'singularity', label: 'Singularity' },
]

/**
 * TrajectoryColorPicker — selector de modo de color para la trayectoria.
 * Matching Angular trajectory-color-picker.ts.
 */
export function TrajectoryColorPicker() {
  const mode = useSceneStore(s => s.trajectoryColorMode)
  const setMode = useSceneStore(s => s.setTrajectoryColorMode)

  return (
    <div className="flex flex-wrap gap-1">
      {MODES.map(m => (
        <button
          key={m.key}
          onClick={() => setMode(m.key)}
          className={`px-2 py-1 text-[10px] font-medium rounded-md border transition-all cursor-pointer
            ${mode === m.key
              ? 'bg-primary-weak border-primary-strong text-primary'
              : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
