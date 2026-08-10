import { useState, useMemo } from 'react'
import { useAnalysisStore } from '../store'
import {
  manipulabilitySeriesOf,
  regionShareOfPlan,
} from '@/shared/contracts/analysis-report'
import type { ProblemRegionWire as ProblemRegion } from '@/shared/contracts/analysis-report'
import { ChevronDown, ChevronRight } from 'lucide-react'

type SeverityTier = 'critical' | 'warning' | 'info'

/**
 * ProblemRegions — lista de regiones problemáticas agrupadas por severidad.
 * Derives from the canonical report's `problem_regions` (backend-projected
 * via ProblemRegionsDtoAdapter; I3: interpretation from kind/severity).
 */
export function ProblemRegions() {
  const report = useAnalysisStore(s => s.report)
  const regions = report?.problem_regions ?? []
  const selectRegion = useAnalysisStore(s => s.selectRegion)
  const selectedId = useAnalysisStore(s => s.selectedRegionId)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  const categories = useMemo(() => {
    const kinds = new Set(regions.map(r => categoryLabel(r.kind)))
    return [...kinds].sort()
  }, [regions])

  const filteredRegions = useMemo(() => {
    if (activeFilter === null) return regions
    return regions.filter(r => categoryLabel(r.kind) === activeFilter)
  }, [regions, activeFilter])

  const grouped = useMemo(() => {
    const groups: Record<SeverityTier, ProblemRegion[]> = { critical: [], warning: [], info: [] }
    for (const r of filteredRegions) {
      const tier = r.severity === 'critical' || r.severity === 'error' ? 'critical'
        : r.severity === 'warning' ? 'warning' : 'info'
      groups[tier].push(r)
    }
    return groups
  }, [filteredRegions])

  const tiers: SeverityTier[] = ['critical', 'warning', 'info']
  const [openTiers, setOpenTiers] = useState<Record<string, boolean>>({ critical: true })

  const toggleTier = (tier: string) => setOpenTiers(prev => ({ ...prev, [tier]: !prev[tier] }))

  if (regions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6">
        No problem regions found.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Filtros */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <FilterChip label={`All (${regions.length})`} active={activeFilter === null} onClick={() => setActiveFilter(null)} />
          {categories.map(cat => (
            <FilterChip
              key={cat}
              label={`${cat} (${regions.filter(r => categoryLabel(r.kind) === cat).length})`}
              active={activeFilter === cat}
              onClick={() => setActiveFilter(activeFilter === cat ? null : cat)}
            />
          ))}
        </div>
      )}

      {/* Grupos por severidad */}
      {tiers.map(tier => {
        const list = grouped[tier]
        if (list.length === 0) return null
        const open = openTiers[tier] ?? false
        return (
          <div key={tier} className="rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => toggleTier(tier)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors
                ${tier === 'critical' ? 'bg-destructive-weak text-destructive hover:bg-destructive-weak' : ''}
                ${tier === 'warning' ? 'bg-warning-weak text-chart-4 hover:bg-warning-weak' : ''}
                ${tier === 'info' ? 'bg-muted text-muted-foreground hover:bg-accent/50' : ''}
              `}
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span className="flex-1 text-left">{tierLabel(tier)}</span>
              <span className="text-[10px] opacity-60 tabular-nums">{list.length}</span>
            </button>
            {open && (
              <div className="p-1.5 flex flex-col gap-1">
                {list.map(region => (
                  <RegionCard
                    key={region.id}
                    region={region}
                    selected={selectedId === region.id}
                    onSelect={() => selectRegion(selectedId === region.id ? null : region.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[10px] font-medium rounded-md border transition-all cursor-pointer
        ${active
          ? 'bg-primary-weak border-primary-mid text-primary'
          : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50'
        }`}
    >
      {label}
    </button>
  )
}

function RegionCard({ region, selected, onSelect }: { region: ProblemRegion; selected: boolean; onSelect: () => void }) {
  const cause = region.explanation?.cause ?? region.kind.replace(/_/g, ' ')
  const wpRange = region.waypoint_end > region.waypoint_start
    ? `wp${region.waypoint_start}–wp${region.waypoint_end}`
    : `wp${region.waypoint_start}`
  const findingCount = (region.metrics?.error_count ?? 0) + (region.metrics?.warning_count ?? 0)
  const report = useAnalysisStore(s => s.report)
  const share = report
    ? regionShareOfPlan(region, manipulabilitySeriesOf(report), report.metrics)
    : { percentOfPlan: null as number | null, durationSecs: null }

  const tier = region.severity === 'critical' || region.severity === 'error' ? 'critical'
    : region.severity === 'warning' ? 'warning' : 'info'

  const tierStyles = {
    critical: 'border-l-destructive bg-destructive/5 hover:bg-destructive-weak',
    warning: 'border-l-chart-4 bg-chart-4/5 hover:bg-warning-weak',
    info: 'border-l-muted-foreground bg-card/50 hover:bg-accent/30',
  }

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-lg border border-border border-l-4 transition-all cursor-pointer
        ${tierStyles[tier]}
        ${selected ? 'ring-1 ring-primary-mid' : ''}
      `}
    >
      <div className="text-xs font-medium text-foreground truncate mb-0.5">{cause}</div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="capitalize">{categoryLabel(region.kind)}</span>
        <span className="font-mono">{wpRange}</span>
        {findingCount > 0 && <span>{findingCount} finding{findingCount !== 1 ? 's' : ''}</span>}
        {share.percentOfPlan !== null && (
          <span className="font-mono tabular-nums">{share.percentOfPlan.toFixed(1)}% del plan</span>
        )}
      </div>
    </button>
  )
}

function tierLabel(tier: SeverityTier): string {
  const labels = { critical: 'Critical', warning: 'Warning', info: 'Info' }
  return labels[tier]
}

function categoryLabel(kind: string): string {
  const map: Record<string, string> = {
    collision: 'Collision', low_manipulability: 'Kinematic', singularity: 'Kinematic',
    low_clearance: 'Collision', joint_limit: 'Constraint', joint_velocity: 'Velocity',
    velocity: 'Velocity', tracking: 'Tracking',
  }
  return map[kind] ?? kind.replace(/_/g, ' ')
}
