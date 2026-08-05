import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useWorkspaceStore, type PointCloudColorMode } from '../store/workspace-store'
import { useWorkspaceService } from '../services/service-context'
import { FlaskConical, Loader2 } from 'lucide-react'
import { ErrorBox } from '@/components/ui/error-box'
import {
  MetricRow,
  MetricValue,
  SectionHeader,
  gradeBadge,
  gradeBadgeInverse,
} from './analysis-metrics'

/**
 * AnalysisWorkspace — inline workspace-sampling section (PR-C).
 *
 * Replaces the old blocking modal (analysis-dialog.tsx) with a non-blocking
 * inline section. Sampling is triggered EXPLICITLY via "Run Analysis" — it
 * never auto-runs on mount, because 10k samples is slow (spec: Explicit Run
 * Trigger). All three services target the scene chain via /active endpoints
 * (null robot id, spec R3).
 *
 * Distinct from plan-analysis (/planning, useAnalysisStore): this tool uses
 * useWorkspaceStore and WorkspaceService only (spec: Distinct from Plan
 * Analysis).
 */
export function AnalysisWorkspace() {
  const service = useWorkspaceService()
  const selectedId = useRobotStore(s => s.selectedId)
  const runtime = useSceneStore(s => s.runtime)
  const robotLoaded = !!selectedId || !!runtime

  const setSamples = useWorkspaceStore(s => s.setSamples)
  const setColorMode = useWorkspaceStore(s => s.setColorMode)
  const setShowPointCloud = useWorkspaceStore(s => s.setShowPointCloud)
  const colorMode = useWorkspaceStore(s => s.colorMode)
  const showPointCloud = useWorkspaceStore(s => s.showPointCloud)
  const hasAnySamples = useWorkspaceStore(s =>
    s.workspaceSamples !== null || s.singularitySamples !== null || s.manipulabilitySamples !== null)

  // Local config inputs (spec: config inputs — local state, no auto-run).
  const [samples, setSamplesCount] = useState(10_000)
  const [seed, setSeed] = useState(0)
  const [tolerance, setTolerance] = useState(0.001)

  const params = { samples, seed, tolerance }

  const ws = useMutation({
    mutationFn: () => service.sample(null, params),
    onSuccess: (data) => {
      setSamples('workspace', data.samples)
      if (colorMode === 'none') {
        setColorMode('workspace')
        setShowPointCloud(true)
      }
    },
  })

  const sg = useMutation({
    mutationFn: () => service.analyzeSingularity(null, params),
    onSuccess: (data) => {
      setSamples('singularity', data.samples)
      if (colorMode === 'none') {
        setColorMode('singularity')
        setShowPointCloud(true)
      }
    },
  })

  const mp = useMutation({
    mutationFn: () => service.analyzeManipulability(null, params),
    onSuccess: (data) => {
      setSamples('manipulability', data.samples)
      if (colorMode === 'none') {
        setColorMode('manipulability')
        setShowPointCloud(true)
      }
    },
  })

  const runAnalysis = () => {
    ws.mutate()
    sg.mutate()
    mp.mutate()
  }

  const isRunning = ws.isPending || sg.isPending || mp.isPending

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
          <NumberInput label="Samples" value={samples} onChange={setSamplesCount} min={100} max={100000} step={100} />
          <NumberInput label="Seed" value={seed} onChange={setSeed} />
          <NumberInput label="Tolerance" value={tolerance} onChange={setTolerance} min={0.001} step={0.001} />
        </div>
      </div>

      {/* ── Explicit trigger (no auto-run on mount) ── */}
      <button
        onClick={runAnalysis}
        disabled={!robotLoaded || isRunning}
        title={!robotLoaded ? 'No robot loaded' : undefined}
        className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium
                   rounded-lg border border-primary-mid bg-primary-weak text-primary
                   hover:bg-primary-weak hover:border-primary-strong
                   transition-all cursor-pointer
                   disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        Run Analysis
      </button>

      {/* ── Loading ── */}
      {isRunning && (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Running 3 analyses…</span>
        </div>
      )}

      {/* ── Errors ── */}
      {ws.error && <ErrorBox error={(ws.error as Error)} />}
      {sg.error && <ErrorBox error={(sg.error as Error)} />}
      {mp.error && <ErrorBox error={(mp.error as Error)} />}

      {/* ── Inline results ── */}
      {ws.data && (
        <section>
          <SectionHeader title="Workspace" />
          <div className="space-y-3">
            <MetricRow
              label="Bounding Volume"
              value={ws.data.metrics.bounding_volume}
              max={10}
              unit="m³"
            />
            <MetricRow
              label="Max Reach"
              value={ws.data.metrics.max_reach}
              max={2}
              unit="m"
            />
            <MetricRow
              label="Min Reach"
              value={ws.data.metrics.min_reach}
              max={2}
              unit="m"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
              <span>Sample count</span>
              <span className="font-mono tabular-nums text-foreground">{ws.data.metrics.sample_count ?? '—'}</span>
            </div>
          </div>
        </section>
      )}

      {sg.data && (
        <section>
          <SectionHeader
            title="Singularity"
            badge={gradeBadge(sg.data.metrics.singular_count, sg.data.metrics.total_samples)}
          />
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MetricValue label="Normal" value={sg.data.metrics.normal_count} color="#44cc44" />
              <MetricValue label="Near Singular" value={sg.data.metrics.near_singular_count} color="#eebb22" />
              <MetricValue label="Singular" value={sg.data.metrics.singular_count} color="#ee3333" />
            </div>
            <MetricRow
              label="Avg Condition Number"
              value={sg.data.metrics.avg_condition_number}
              max={500}
              inverse
              unit="σ"
            />
            <MetricRow
              label="Min σₘᵢₙ"
              value={sg.data.metrics.min_condition_number}
              max={500}
              inverse
              unit="σ"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
              <span>Total samples</span>
              <span className="font-mono tabular-nums text-foreground">{sg.data.metrics.total_samples ?? '—'}</span>
            </div>
          </div>
        </section>
      )}

      {mp.data && (
        <section>
          <SectionHeader
            title="Manipulability"
            badge={gradeBadgeInverse(mp.data.metrics.avg_yoshikawa)}
          />
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <MetricValue label="Avg Yoshikawa" value={mp.data.metrics.avg_yoshikawa} pct />
              <MetricValue label="Min" value={mp.data.metrics.min_yoshikawa} pct />
              <MetricValue label="Max" value={mp.data.metrics.max_yoshikawa} pct />
            </div>
            <MetricRow
              label="Avg Isotropy"
              value={mp.data.metrics.avg_isotropy}
              max={1}
              pct
            />
            <MetricRow
              label="Min Isotropy"
              value={mp.data.metrics.min_isotropy}
              max={1}
              pct
            />
            <MetricRow
              label="Max Isotropy"
              value={mp.data.metrics.max_isotropy}
              max={1}
              pct
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
              <span>Total samples</span>
              <span className="font-mono tabular-nums text-foreground">{mp.data.metrics.total_samples ?? '—'}</span>
            </div>
          </div>
        </section>
      )}

      {!isRunning && !ws.data && !sg.data && !mp.data && (
        <p className="text-sm text-muted-foreground text-center py-4">No data yet — run the analysis</p>
      )}

      {/* ── Point-cloud visualization controls (spec: preserved) ── */}
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
