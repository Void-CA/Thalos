import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorkspaceService } from '../services/service-context'
import { useWorkspaceStore } from '../store/workspace-store'
import { Loader2 } from 'lucide-react'
import {
  ErrorBox,
  MetricRow,
  MetricValue,
  SectionHeader,
  gradeBadge,
  gradeBadgeInverse,
} from './analysis-metrics'

interface AnalysisDialogProps {
  open: boolean
  onClose: () => void
  samples: number
  seed: number
  tolerance: number
}

/**
 * AnalysisDialog — ejecuta los 3 análisis y muestra resultados
 * con métricas visuales (barras de progreso, badges).
 */
export function AnalysisDialog({ open, onClose, samples, seed, tolerance }: AnalysisDialogProps) {
  const service = useWorkspaceService()
  const setSamples = useWorkspaceStore(s => s.setSamples)
  const setColorMode = useWorkspaceStore(s => s.setColorMode)
  const setShowPointCloud = useWorkspaceStore(s => s.setShowPointCloud)
  const colorMode = useWorkspaceStore(s => s.colorMode)

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

  useEffect(() => {
    if (open) { ws.mutate(); sg.mutate(); mp.mutate() }
  }, [open])

  const isRunning = ws.isPending || sg.isPending || mp.isPending

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workspace Analysis</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Loading */}
          {isRunning && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Running 3 analyses…</span>
            </div>
          )}

          {/* Errors */}
          {ws.error && <ErrorBox message={(ws.error as Error).message} />}
          {sg.error && <ErrorBox message={(sg.error as Error).message} />}
          {mp.error && <ErrorBox message={(mp.error as Error).message} />}

          {/* Workspace */}
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

          {/* Singularity */}
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

          {/* Manipulability */}
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
            <p className="text-sm text-muted-foreground text-center py-4">No data returned</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
