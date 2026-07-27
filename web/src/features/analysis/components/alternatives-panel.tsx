import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/shared/api-client'
import { Lightbulb, Loader2 } from 'lucide-react'

interface RankedAlternative {
  rank: number
  source_waypoint: number
  perturbations: { waypoint: number; joint: number; delta: number }[]
  score: number
  original_score: number
  delta_score: number
  improvement_percent: number
  improvements: string[]
  breakdown: { name: string; original: number; candidate: number }[]
}

interface AlternativesResponse {
  original_score: number
  original_breakdown: { name: string; value: number }[]
  alternatives: RankedAlternative[]
  total_candidates: number
}

/**
 * AlternativesPanel — alternativas rankeadas al plan activo.
 * Matching Angular alternatives-panel.ts.
 */
export function AlternativesPanel() {
  const [selectedRank, setSelectedRank] = useState<number | null>(null)

  const query = useMutation({
    mutationFn: () =>
      apiClient.post<AlternativesResponse>('/plan/analyze/alternatives', {}).then(r => r.data),
  })

  const data = query.data
  const hasData = data && data.alternatives.length > 0

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => query.mutate()}
        disabled={query.isPending}
        className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium
                   rounded-lg border border-primary-mid bg-primary-weak text-primary
                   hover:bg-primary-weak transition-all cursor-pointer disabled:opacity-40"
      >
        {query.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
        {query.isPending ? 'Generating…' : 'Generate Alternatives'}
      </button>

      {query.error && (
        <div className="text-xs text-destructive">{(query.error as Error).message}</div>
      )}

      {data && data.alternatives.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">
          No alternatives found. The plan may have no problematic waypoints.
        </p>
      )}

      {hasData && (
        <div className="flex flex-col gap-2">
          {/* Original score bar */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Original Score</span>
            <span className="font-mono font-semibold tabular-nums">{data.original_score.toFixed(4)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-muted-foreground/30" style={{ width: `${scorePct(data.original_score)}%` }} />
          </div>

          {/* Alternatives */}
          <div className="flex flex-col gap-1.5">
            {data.alternatives.map(alt => {
              const isSelected = selectedRank === alt.rank
              const wpRange = perturbationRange(alt.perturbations)
              return (
                <button
                  key={alt.rank}
                  onClick={() => setSelectedRank(isSelected ? null : alt.rank)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer
                    ${isSelected ? 'border-primary-mid bg-primary/5' : 'border-border bg-card/50 hover:bg-accent/30'}
                    ${alt.rank === 1 ? 'ring-1 ring-warning-mid' : ''}
                  `}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className={`text-xs font-bold ${alt.rank === 1 ? 'text-chart-4' : 'text-foreground'}`}>
                      #{alt.rank}
                    </span>
                    <span className="text-xs font-mono font-semibold tabular-nums">{alt.score.toFixed(4)}</span>
                    <span className={`text-[10px] font-mono ${alt.delta_score > 0 ? 'text-chart-3' : 'text-destructive'}`}>
                      {alt.delta_score > 0 ? '▲' : '▼'} {alt.improvement_percent.toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-muted-foreground">vs {alt.original_score.toFixed(4)}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">Waypoints {wpRange.min}{wpRange.max > wpRange.min ? `–${wpRange.max}` : ''}</span>
                  </div>

                  {alt.improvements.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {alt.improvements.map((imp, i) => (
                        <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${imp.includes('worse') ? 'bg-destructive-weak text-destructive' : 'bg-success-weak text-chart-3'}`}>
                          {imp}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function perturbationRange(perturbations: { waypoint: number }[]): { min: number; max: number } {
  let min = Infinity, max = -Infinity
  for (const p of perturbations) {
    if (p.waypoint < min) min = p.waypoint
    if (p.waypoint > max) max = p.waypoint
  }
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max }
}

function scorePct(score: number): number {
  return Math.max(0, Math.min(100, (1 - score / 100) * 100))
}
