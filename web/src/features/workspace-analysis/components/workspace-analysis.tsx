import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '@/features/viewport/store'
import { useWorkspaceStore, type PointCloudColorMode } from '../workspace-analysis-store'
import { useWorkspaceService } from '@/features/viewport/services/service-context'
import { FlaskConical, Loader2 } from 'lucide-react'
import { ErrorBox } from '@/components/ui/error-box'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { WORKSPACE_PRESETS, DEFAULT_PRESET_KEY } from './presets'
import { histogram } from './histogram'
import { HistogramBars, CategoricalBars } from './histogram-bars'
import {
  MetricRow,
  MetricRange,
  MetricValue,
  SectionHeader,
  gradeBadge,
  gradeBadgeInverse,
} from './analysis-metrics'

/**
 * WorkspaceAnalysis — "What can this robot do?"
 *
 * A first-class characterization tool (features/workspace-analysis), distinct
 * from Evaluation ("How good/safe is this trajectory?"). Sampling is triggered
 * EXPLICITLY via "Run Analysis" — it never auto-runs on mount, because 10k
 * samples is slow (spec: Explicit Run Trigger). All three services target the
 * scene chain via /active endpoints (null robot id, spec R3).
 *
 * P0-B reorg: this tool renders INSIDE the Robot shell accordion
 * (TOOLS_BY_PERSPECTIVE.robot) — the accordion trigger already shows the
 * "Workspace Analysis" label, so the duplicate h2 title is gone. The inline
 * report now also renders a small distribution histogram per analysis type,
 * DERIVED from the samples already in the store (no backend changes).
 *
 * The 3D point cloud (features/viewport/renderer/point-cloud.tsx) is the
 * visualization: it stays driven by this feature's store (colorMode /
 * showPointCloud / workspaceSamples), so choosing a color mode immediately
 * re-colors the cloud wherever the viewport renders. The inline report is
 * TABBED (one tab per feature); the active tab drives the cloud color mode
 * one-directionally (tab → color), and the manual color control below remains
 * an override that never rewinds the active tab.
 */
export function WorkspaceAnalysis() {
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

  // Store samples feed the distribution histograms (derived, no new data).
  const workspaceSamples = useWorkspaceStore(s => s.workspaceSamples)
  const singularitySamples = useWorkspaceStore(s => s.singularitySamples)
  const manipulabilitySamples = useWorkspaceStore(s => s.manipulabilitySamples)

  const reachHistogram = useMemo(() => {
    if (!workspaceSamples || workspaceSamples.length === 0) return null
    const reach = workspaceSamples.map(point => Math.hypot(...point.position))
    return histogram(reach, 10)
  }, [workspaceSamples])

  const yoshikawaHistogram = useMemo(() => {
    if (!manipulabilitySamples || manipulabilitySamples.length === 0) return null
    const values = manipulabilitySamples
      .map(point => point.yoshikawa)
      .filter((value): value is number => typeof value === 'number')
    if (values.length === 0) return null
    return histogram(values, 10)
  }, [manipulabilitySamples])

  const stateCounts = useMemo(() => {
    if (!singularitySamples || singularitySamples.length === 0) return null
    const counts = { normal: 0, near_singular: 0, singular: 0 }
    for (const point of singularitySamples) {
      if (point.state === 'normal') counts.normal += 1
      else if (point.state === 'near_singular') counts.near_singular += 1
      else if (point.state === 'singular') counts.singular += 1
    }
    return counts
  }, [singularitySamples])

  // Local config inputs (spec: config inputs — local state, no auto-run).
  const [samples, setSamplesCount] = useState(10_000)
  const [seed, setSeed] = useState(0)
  const [tolerance, setTolerance] = useState(0.001)
  // Active preset key; null once the advanced fields are edited (override wins).
  const [presetKey, setPresetKey] = useState<string | null>(DEFAULT_PRESET_KEY)

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

  // ── Tabbed report: one tab per analyzed feature, coupled to the 3D cloud ──
  // The ACTIVE tab drives the point-cloud color mode (tab → color, one
  // direction). The manual "Point Cloud Color" control below stays an
  // override that never rewinds the active tab. Default tab = the first
  // feature that produced data (workspace → singularity → manipulability).
  type ReportTab = 'workspace' | 'singularity' | 'manipulability'
  const [activeTab, setActiveTab] = useState<ReportTab | null>(null)

  const hasResults = !!ws.data || !!sg.data || !!mp.data
  const availableTabs: ReportTab[] = []
  if (ws.data) availableTabs.push('workspace')
  if (sg.data) availableTabs.push('singularity')
  if (mp.data) availableTabs.push('manipulability')
  const effectiveTab = activeTab ?? availableTabs[0] ?? null

  const selectTab = (tab: ReportTab) => {
    setActiveTab(tab)
    setColorMode(tab)
    setShowPointCloud(true)
  }

  return (
    <div className="flex flex-col gap-3 p-1.5">
      {/* ── Purpose (conceptual split: characterization tool, not decision stage) ── */}
      <header>
        <p className="text-xs text-muted-foreground">What can this robot do?</p>
        <p className="text-xs text-muted-foreground mt-1.5">
          How good or safe a trajectory is gets evaluated in{' '}
          <Link to="/evaluation" className="text-primary underline underline-offset-2 hover:text-primary-strong">
            Evaluation
          </Link>
          .
        </p>
      </header>

      {/* ── Presets (Quick / Balanced / Precise — no raw config by default) ── */}
      <div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
          Sampling Preset
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          {WORKSPACE_PRESETS.map(preset => (
            <button
              key={preset.key}
              onClick={() => {
                setPresetKey(preset.key)
                setSamplesCount(preset.samples)
              }}
              className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-all cursor-pointer
                ${presetKey === preset.key
                  ? 'bg-primary-weak border-primary-mid text-primary'
                  : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Advanced config behind a disclosure (editing overrides the preset) ── */}
      <details
        className="text-xs text-muted-foreground"
        onToggle={e => { if (e.currentTarget.open) setPresetKey(null) }}
      >
        <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          Advanced Config
        </summary>
        <div className="grid grid-cols-3 gap-1.5 mt-1.5">
          <NumberInput label="Samples" value={samples} onChange={v => { setSamplesCount(v); setPresetKey(null) }} min={100} max={100000} step={100} />
          <NumberInput label="Seed" value={seed} onChange={v => { setSeed(v); setPresetKey(null) }} />
          <NumberInput label="Tolerance" value={tolerance} onChange={v => { setTolerance(v); setPresetKey(null) }} min={0.001} step={0.001} />
        </div>
      </details>

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

      {/* ── Tabbed inline results: one tab per analyzed feature. The active
       * tab is coupled to the 3D point cloud — switching re-colors it. ── */}
      {hasResults && effectiveTab && (
        <Tabs value={effectiveTab} onValueChange={(tab) => selectTab(tab as ReportTab)}>
          <TabsList className="mx-3 mt-3 shrink-0 w-full">
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="singularity">Singularity</TabsTrigger>
            <TabsTrigger value="manipulability">Manipulability</TabsTrigger>
          </TabsList>

          <TabsContent value="workspace">
            {ws.data ? (
              <section>
                <SectionHeader title="Workspace" />
                <div className="space-y-3">
                  <MetricRow
                    label="Bounding Volume"
                    value={ws.data.metrics.bounding_volume}
                    max={10}
                    unit="m³"
                  />
                  <MetricRange
                    label="Reach"
                    min={ws.data.metrics.min_reach}
                    max={ws.data.metrics.max_reach}
                    unit="m"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
                    <span>Sample count</span>
                    <span className="font-mono tabular-nums text-foreground">{ws.data.metrics.sample_count ?? '—'}</span>
                  </div>
                  {reachHistogram && (
                    <div className="pt-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Reach distribution
                      </span>
                      <HistogramBars data={reachHistogram} formatValue={v => v.toFixed(2)} />
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {ws.error ? 'Workspace analysis failed' : 'No workspace data yet'}
              </p>
            )}
          </TabsContent>

          <TabsContent value="singularity">
            {sg.data ? (
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
                  <div className="grid grid-cols-2 gap-2">
                    <MetricValue label="Avg Condition Number" value={sg.data.metrics.avg_condition_number} unit="σ" />
                    <MetricValue label="Min σₘᵢₙ" value={sg.data.metrics.min_condition_number} unit="σ" />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
                    <span>Total samples</span>
                    <span className="font-mono tabular-nums text-foreground">{sg.data.metrics.total_samples ?? '—'}</span>
                  </div>
                  {stateCounts && (
                    <div className="pt-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                        State distribution
                      </span>
                      <CategoricalBars
                        categories={[
                          { label: 'Normal', count: stateCounts.normal, color: '#44cc44' },
                          { label: 'Near Sing.', count: stateCounts.near_singular, color: '#eebb22' },
                          { label: 'Singular', count: stateCounts.singular, color: '#ee3333' },
                        ]}
                      />
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {sg.error ? 'Singularity analysis failed' : 'No singularity data yet'}
              </p>
            )}
          </TabsContent>

          <TabsContent value="manipulability">
            {mp.data ? (
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
                  <MetricRange
                    label="Isotropy"
                    min={mp.data.metrics.min_isotropy}
                    max={mp.data.metrics.max_isotropy}
                    pct
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
                    <span>Total samples</span>
                    <span className="font-mono tabular-nums text-foreground">{mp.data.metrics.total_samples ?? '—'}</span>
                  </div>
                  {yoshikawaHistogram && (
                    <div className="pt-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Yoshikawa distribution
                      </span>
                      <HistogramBars data={yoshikawaHistogram} formatValue={v => v.toFixed(3)} />
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {mp.error ? 'Manipulability analysis failed' : 'No manipulability data yet'}
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}

      {!isRunning && !hasResults && (
        <p className="text-sm text-muted-foreground text-center py-4">No data yet — run the analysis</p>
      )}

      {/* ── Point-cloud visualization controls. The active TAB drives the cloud
       * color mode; these manual controls stay available as an override. ── */}
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
        aria-label={label}
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
