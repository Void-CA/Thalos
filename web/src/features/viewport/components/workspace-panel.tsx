import { useState } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useWorkspaceStore, type PointCloudColorMode } from '../store/workspace-store'
import { AnalysisDialog } from './analysis-dialog'
import { FlaskConical } from 'lucide-react'

/**
 * Workspace Panel — simplificado a:
 *   - Config de sampling
 *   - Botón único "Analyze" → abre modal con los 3 resultados
 *   - Color mode selector para la nube de puntos
 *   - Toggle de visibilidad
 */
export function WorkspacePanel() {
  const selectedId = useRobotStore(s => s.selectedId)
  const runtime = useSceneStore(s => s.runtime)
  const disabledReason = !selectedId && !runtime ? 'No robot loaded' : null

  const colorMode = useWorkspaceStore(s => s.colorMode)
  const setColorMode = useWorkspaceStore(s => s.setColorMode)
  const showPointCloud = useWorkspaceStore(s => s.showPointCloud)
  const setShowPointCloud = useWorkspaceStore(s => s.setShowPointCloud)
  const hasAnySamples = useWorkspaceStore(s =>
    s.workspaceSamples !== null || s.singularitySamples !== null || s.manipulabilitySamples !== null)

  const [samples, setSamples] = useState(10_000)
  const [seed, setSeed] = useState(0)
  const [tolerance, setTolerance] = useState(0.001)
  const [dialogOpen, setDialogOpen] = useState(false)

  const modes: { key: PointCloudColorMode; label: string }[] = [
    { key: 'none', label: 'None' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'singularity', label: 'Singularity' },
    { key: 'manipulability', label: 'Manipulability' },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* ── Config ── */}
      <div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
          Config
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          <NumberInput label="Samples" value={samples} onChange={setSamples} min={100} max={100000} step={100} />
          <NumberInput label="Seed" value={seed} onChange={setSeed} />
          <NumberInput label="Tolerance" value={tolerance} onChange={setTolerance} min={0.001} step={0.001} />
        </div>
      </div>

      {/* ── Analyze button ── */}
      <button
        onClick={() => setDialogOpen(true)}
        disabled={!!disabledReason}
        title={disabledReason ?? undefined}
        className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium
                   rounded-lg border border-primary-mid bg-primary-weak text-primary
                   hover:bg-primary-weak hover:border-primary-strong
                   transition-all cursor-pointer
                   disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        Analyze Workspace
      </button>

      {/* ── Color mode ── */}
      {hasAnySamples && (
        <div className="border-t border-border pt-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Point Cloud Color
          </span>
          <div className="grid grid-cols-2 gap-1">
            {modes.map(m => (
              <button
                key={m.key}
                onClick={() => setColorMode(m.key)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-all cursor-pointer
                  ${colorMode === m.key
                    ? 'bg-primary-weak border-primary-mid text-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Toggle visible solo si hay un color mode activo */}
          {colorMode !== 'none' && (
            <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
              <input
                type="checkbox"
                checked={showPointCloud}
                onChange={e => setShowPointCloud(e.target.checked)}
                className="accent-primary w-3.5 h-3.5 rounded border-border"
              />
              <span className="text-xs text-muted-foreground">Show Point Cloud</span>
            </label>
          )}
        </div>
      )}

      {/* ── Dialog ── */}
      <AnalysisDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        samples={samples}
        seed={seed}
        tolerance={tolerance}
      />
    </div>
  )
}

function NumberInput({
  label, value, onChange, min, max, step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full text-xs font-mono bg-input border border-border rounded-md
                   px-2 py-1.5 text-left tabular-nums
                   focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring-weak
                   [appearance:textfield]
                   [&::-webkit-outer-spin-button]:appearance-none
                   [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}
