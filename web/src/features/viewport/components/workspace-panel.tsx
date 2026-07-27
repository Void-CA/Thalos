import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useWorkspaceService } from '../services/service-context'
import { Loader2, AlertCircle, FlaskConical, Workflow, Sigma } from 'lucide-react'

/**
 * Workspace Panel — workspace sampling / singularity / manipulability analysis.
 *
 * Dependencia: WorkspaceService (inyectado via ServicesProvider).
 */
export function WorkspacePanel() {
  const service = useWorkspaceService()
  const selectedId = useRobotStore(s => s.selectedId)
  const runtime = useSceneStore(s => s.runtime)
  const disabledReason = !selectedId && !runtime ? 'No robot loaded' : null

  const [samples, setSamples] = useState(10_000)
  const [seed, setSeed] = useState(0)
  const [tolerance, setTolerance] = useState(0.001)

  const sampleMutation = useMutation({
    mutationFn: (params: typeof defaultParams) => service.sample(selectedId, params),
  })

  const singularityMutation = useMutation({
    mutationFn: (params: typeof defaultParams) => service.analyzeSingularity(selectedId, params),
  })

  const manipulabilityMutation = useMutation({
    mutationFn: (params: typeof defaultParams) => service.analyzeManipulability(selectedId, params),
  })

  const defaultParams = { samples, seed, tolerance }
  const isWorking = sampleMutation.isPending || singularityMutation.isPending || manipulabilityMutation.isPending

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

      {/* ── Actions ── */}
      <div className="flex flex-col gap-1.5">
        <ActionButton
          icon={sampleMutation.isPending ? Loader2 : FlaskConical}
          label="Sample Workspace"
          onClick={() => sampleMutation.mutate(defaultParams)}
          disabled={!!disabledReason || isWorking}
          title={disabledReason ?? undefined}
        />
        <ActionButton
          icon={singularityMutation.isPending ? Loader2 : Workflow}
          label="Singularity Analysis"
          onClick={() => singularityMutation.mutate(defaultParams)}
          disabled={!!disabledReason || isWorking}
          title={disabledReason ?? undefined}
        />
        <ActionButton
          icon={manipulabilityMutation.isPending ? Loader2 : Sigma}
          label="Manipulability"
          onClick={() => manipulabilityMutation.mutate(defaultParams)}
          disabled={!!disabledReason || isWorking}
          title={disabledReason ?? undefined}
        />
      </div>

      {/* ── Results ── */}
      {sampleMutation.data && <ResultCard title="Workspace" data={sampleMutation.data} />}
      {singularityMutation.data && <ResultCard title="Singularity" data={singularityMutation.data} />}
      {manipulabilityMutation.data && <ResultCard title="Manipulability" data={manipulabilityMutation.data} />}

      {/* ── Errors ── */}
      {sampleMutation.error && <ErrorMsg message={(sampleMutation.error as Error).message} />}
      {singularityMutation.error && <ErrorMsg message={(singularityMutation.error as Error).message} />}
      {manipulabilityMutation.error && <ErrorMsg message={(manipulabilityMutation.error as Error).message} />}
    </div>
  )
}

// ── Subcomponents ──

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
                   focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/30
                   [appearance:textfield]
                   [&::-webkit-outer-spin-button]:appearance-none
                   [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number }>
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-2 w-full px-3 py-2 text-xs font-medium
                 rounded-lg border border-border bg-secondary/50 text-foreground
                 hover:bg-accent/60 hover:border-border
                 transition-all cursor-pointer
                 disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-secondary/50"
    >
      <Icon className={`h-3.5 w-3.5 text-primary ${disabled && Icon === Loader2 ? 'animate-spin' : ''}`} />
      {label}
    </button>
  )
}

function ResultCard({ title, data }: { title: string; data: { metrics: Record<string, number> } }) {
  const metrics = data.metrics
  if (!metrics) return null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-1.5 bg-secondary/30 border-b border-border">
        <span className="text-[11px] font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-2.5 grid grid-cols-2 gap-1.5">
        {Object.entries(metrics).map(([key, val]) => (
          <div key={key} className="flex flex-col gap-0.5 bg-secondary/20 rounded px-2 py-1">
            <span className="text-[10px] text-muted-foreground truncate">{key.replace(/_/g, ' ')}</span>
            <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
              {typeof val === 'number' ? val.toFixed(4) : String(val)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
