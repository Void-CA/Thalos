import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAnalysisStore, useSelectedRegion } from '../store'
import { apiClient } from '@/shared/api-client'
import { Lightbulb, Check, Undo2, X } from 'lucide-react'

/**
 * RegionInspector — panel contextual con preview, apply y undo.
 * Matching Angular region-inspector.ts.
 */
export function RegionInspector() {
  const region = useSelectedRegion()
  const selectRegion = useAnalysisStore(s => s.selectRegion)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [previewResult, setPreviewResult] = useState<any>(null)
  const [historyCount, setHistoryCount] = useState(0)
  const [strategy, setStrategy] = useState<string | null>(null)

  const createSession = useMutation({
    mutationFn: () => apiClient.post('/repair/sessions', {}).then(r => r.data as { session_id: number }),
    onSuccess: (data) => setSessionId(data.session_id),
  })

  const previewRepair = useMutation({
    mutationFn: async (strat: string) => {
      if (!sessionId || !region) return
      const { data } = await apiClient.post(`/repair/sessions/${sessionId}/preview`, {
        region_id: region.id, strategy: strat,
      })
      return data as { candidate_id: number; continuity_ok: boolean; improvement: number }
    },
    onSuccess: (data) => setPreviewResult(data),
  })

  const apply = useMutation({
    mutationFn: async () => {
      if (!sessionId || !previewResult) return null
      const { data } = await apiClient.post(`/repair/sessions/${sessionId}/apply`, {
        candidate_id: previewResult.candidate_id,
      })
      return data as { new_revision: number; status: string; history_length: number }
    },
    onSuccess: (data) => {
      if (!data) return
      setHistoryCount(data.history_length)
      setPreviewResult(null)
      setStrategy(null)
    },
  })

  const undo = useMutation({
    mutationFn: async () => {
      if (!sessionId) return null
      const { data } = await apiClient.post(`/repair/sessions/${sessionId}/undo`, {})
      return data as { new_revision: number; status: string; history_length: number }
    },
    onSuccess: (data) => {
      if (!data) return
      setHistoryCount(data.history_length)
      setPreviewResult(null)
      setStrategy(null)
    },
  })

  if (!region) return null

  const strategies = region.recommended_strategies?.length
    ? region.recommended_strategies
    : region.explanation?.recommended_strategies ?? defaultStrategies(region.kind)

  const wpRange = region.waypoint_end > region.waypoint_start
    ? `wp${region.waypoint_start}–wp${region.waypoint_end}`
    : `wp${region.waypoint_start}`

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Region Details</h3>
        <button onClick={() => selectRegion(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cause */}
      {region.explanation?.cause && (
        <p className="text-sm font-semibold text-foreground">{region.explanation.cause}</p>
      )}

      {/* Metrics */}
      {region.metrics && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Metrics</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {region.metrics.average_value != null && (
              <MetricCard label="Average" value={fmt(region.metrics.average_value)} />
            )}
            {region.metrics.min_value != null && (
              <MetricCard label="Min" value={fmt(region.metrics.min_value)} />
            )}
            {region.metrics.max_value != null && (
              <MetricCard label="Max" value={fmt(region.metrics.max_value)} />
            )}
          </div>
        </div>
      )}

      {/* Impact */}
      {region.explanation?.consequence && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Impact</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{region.explanation.consequence}</p>
        </div>
      )}

      {/* Location */}
      <div>
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Location</h4>
        <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">{wpRange}</span>
      </div>

      {/* Strategies */}
      {strategies.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Strategies</h4>
          <div className="flex flex-col gap-1">
            {strategies.map(s => {
              const isSelected = strategy === s
              return (
                <button
                  key={s}
                  onClick={() => {
                    if (!sessionId) createSession.mutate()
                    setStrategy(s)
                    previewRepair.mutate(s)
                  }}
                  disabled={previewRepair.isPending}
                  className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md border transition-all cursor-pointer text-left
                    ${isSelected
                      ? 'border-chart-4/40 bg-chart-4/10 text-foreground'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }
                  `}
                >
                  <Lightbulb className="h-3 w-3 text-chart-4 shrink-0" />
                  <span>{s.replace(/_/g, ' ')}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Preview result */}
      {previewResult && (
        <div className="rounded-lg border border-chart-3/30 bg-chart-3/10 p-2.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Improvement</span>
            <span className={`font-semibold font-mono tabular-nums ${previewResult.improvement > 0 ? 'text-chart-3' : 'text-destructive'}`}>
              {previewResult.improvement > 0 ? '+' : ''}{previewResult.improvement?.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Continuity</span>
            <span className={`font-semibold ${previewResult.continuity_ok ? 'text-chart-3' : 'text-chart-4'}`}>
              {previewResult.continuity_ok ? 'OK' : 'Warning'}
            </span>
          </div>
          <div className="flex gap-1.5 pt-1">
            <button onClick={() => apply.mutate()} disabled={apply.isPending}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md 
                         border border-chart-3/40 bg-chart-3/15 text-chart-3 hover:bg-chart-3/25 transition-all cursor-pointer disabled:opacity-40">
              <Check className="h-3 w-3" /> {apply.isPending ? 'Applying…' : 'Apply'}
            </button>
            {historyCount > 0 && (
              <button onClick={() => undo.mutate()} disabled={undo.isPending}
                className="inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md
                           border border-border bg-secondary/50 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-40">
                <Undo2 className="h-3 w-3" /> Undo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-secondary/20 rounded-md px-2.5 py-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-sm font-mono font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  )
}

function fmt(val: number): string {
  if (val === 0) return '0'
  const abs = Math.abs(val)
  if (abs >= 0.001) return val.toFixed(4)
  if (abs >= 1e-6) return val.toFixed(6)
  return val.toExponential(2)
}

function defaultStrategies(kind: string): string[] {
  const map: Record<string, string[]> = {
    collision: ['Lift TCP', 'Joint centering', 'Insert waypoint'],
    singularity: ['Joint centering', 'Lift TCP', 'Rotate tool'],
    low_manipulability: ['Joint centering', 'Lift TCP', 'Rotate tool'],
    low_clearance: ['Lift TCP', 'Joint centering', 'Insert waypoint'],
    constraint: ['Joint centering', 'Insert waypoint', 'Lift TCP'],
    velocity: ['Insert waypoint', 'Joint centering'],
    tracking: ['Insert waypoint', 'Joint centering'],
  }
  return map[kind] ?? ['Joint centering', 'Insert waypoint', 'Lift TCP']
}
