import { useMemo, useState } from 'react'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import type { ApplyResponse } from '@/features/analysis/api/plan-analysis.types'
import { useAnalysisStore } from '@/features/analysis/store'
import { useSceneStore } from '@/features/viewport/store'
import { sceneService } from '@/features/viewport/services/scene.service'
import type { SegmentInfo } from '@/features/viewport/types'
import { severityOf } from '@/shared/charts/trajectory3d'
import { Check, Loader2, Pencil, RotateCcw, X } from 'lucide-react'
import {
  buildSegmentEdit,
  clickRegionId,
  isSegmentEditable,
  overlappingRegions,
  segmentType,
  sourceSummary,
  worstRegion,
} from './program-model'

/**
 * ProgramView — structured view of the active plan's motion program with a
 * MINIMAL per-segment edit trigger (CDD step 3). The bridge from "this region
 * has a problem" to "this is the program segment I must edit": each segment
 * row renders its source intent (MoveJ / MoveL / MoveLPosition), the waypoint
 * range it covers and a severity badge when that range overlaps a problem
 * region. Selecting a region (list, inspector or trajectory) highlights the
 * overlapping segment(s); clicking a segment selects its worst overlapping
 * region — selection flows both ways through the analysis store.
 *
 * Step 3 closes the PROGRAM-LEVEL editing circuit: an inline form per segment
 * builds a semantic `ProgramEdit` (MoveWaypoint for MoveJ, ReplaceSegment for
 * MoveLPosition; MoveL is disabled — full-pose editing is deferred), sends it
 * through `POST /plan/program/edit` (same backend apply cycle as
 * apply_command) and refreshes the scene exactly like RecommendationRow
 * (loadScene + applyScene). Feedback shows health before→after; Undo pops the
 * stored inverse (O(1), PR5) and refreshes again.
 */

export function ProgramView() {
  const segments = useSceneStore((s) => s.activePlan?.segments)
  const report = useAnalysisStore((s) => s.report)
  const selectedRegionId = useAnalysisStore((s) => s.selectedRegionId)
  const selectRegion = useAnalysisStore((s) => s.selectRegion)
  const applyScene = useSceneStore((s) => s.applyScene)

  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [feedback, setFeedback] = useState<ApplyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [undoing, setUndoing] = useState(false)

  const regions = useMemo(() => report?.problem_regions ?? [], [report])
  const list = segments ?? []

  if (list.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Program</span>
        <div
          data-testid="program-empty"
          className="text-xs text-muted-foreground text-center py-4 rounded-lg border border-dashed border-border bg-card/30"
        >
          No program segments to display.
        </div>
      </section>
    )
  }

  const startEdit = (segment: SegmentInfo) => {
    if ('MoveJ' in segment.source) {
      setDraft(segment.source.MoveJ.target.map(String))
    } else if ('MoveLPosition' in segment.source) {
      setDraft(segment.source.MoveLPosition.target_position.map(String))
    } else {
      return
    }
    setEditingIndex(segment.segmentIndex)
    setError(null)
  }

  const setDraftAt = (i: number) => (value: string) => {
    setDraft((prev) => {
      const next = [...(prev ?? [])]
      next[i] = value
      return next
    })
  }

  const handleSave = async () => {
    if (editingIndex === null || draft === null) return
    const segment = list[editingIndex]
    if (!segment) return
    setBusy(true)
    setError(null)
    try {
      const edit = buildSegmentEdit(segment, draft.map(Number))
      const res = await planAnalysisApi.editProgram(edit)
      setFeedback(res)
      const snapshot = await sceneService.loadScene()
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
      setEditingIndex(null)
      setDraft(null)
    } catch (err: any) {
      setError(err.message ?? 'Edit failed')
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = () => {
    setEditingIndex(null)
    setDraft(null)
    setError(null)
  }

  const handleUndo = async () => {
    setUndoing(true)
    setError(null)
    try {
      await planAnalysisApi.undo()
      setFeedback(null)
      const snapshot = await sceneService.loadScene()
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
    } catch (err: any) {
      setError(err.message ?? 'Undo failed')
    } finally {
      setUndoing(false)
    }
  }

  return (
    <section
      data-testid="program-view"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Program</span>
        <span className="text-[10px] text-muted-foreground">
          click a segment to select its problem region
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {list.map((segment) => {
          const overlapping = overlappingRegions(segment, regions)
          const worst = worstRegion(overlapping)
          const selected = selectedRegionId !== null && overlapping.some((r) => r.id === selectedRegionId)
          const editable = isSegmentEditable(segment.source)
          const editing = editingIndex === segment.segmentIndex
          return (
            <li key={segment.segmentIndex} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <button
                  data-testid={`program-segment-${segment.segmentIndex}`}
                  data-selected={selected || undefined}
                  data-severity={worst ? severityOf(worst) : undefined}
                  onClick={() => selectRegion(clickRegionId(segment, regions, selectedRegionId))}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-left transition-all cursor-pointer
                    ${selected ? 'ring-1 ring-primary-mid border-primary-mid' : 'hover:bg-secondary/40'}`}
                >
                  <span className="font-mono text-[10px] text-muted-foreground w-7 shrink-0 tabular-nums">
                    [{segment.segmentIndex}]
                  </span>
                  <span className="text-xs font-semibold text-foreground w-28 shrink-0">
                    {segmentType(segment.source)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate flex-1">
                    {sourceSummary(segment.source)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 tabular-nums">
                    wp{segment.waypointStart}–wp{segment.waypointEnd}
                  </span>
                  {worst && <SeverityBadge tier={severityOf(worst)} />}
                </button>
                <button
                  data-testid={`program-edit-${segment.segmentIndex}`}
                  onClick={() => startEdit(segment)}
                  disabled={!editable}
                  title={
                    editable
                      ? 'Edit this segment (free-form ProgramEdit)'
                      : 'MoveL editing (full pose) is not supported yet'
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-2 text-[10px] text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>

              {editing && draft && (
                <div
                  data-testid={`program-edit-form-${segment.segmentIndex}`}
                  className="flex flex-col gap-1.5 rounded-lg border border-primary-mid bg-secondary/20 px-3 py-2"
                >
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Edit {segmentType(segment.source)}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {draft.map((value, i) => (
                      <input
                        key={i}
                        data-testid={`program-edit-input-${segment.segmentIndex}-${i}`}
                        type="number"
                        step="any"
                        value={value}
                        onChange={(e) => setDraftAt(i)(e.target.value)}
                        className="w-20 rounded border border-border bg-card px-1.5 py-1 font-mono text-[10px] text-foreground"
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      data-testid={`program-edit-save-${segment.segmentIndex}`}
                      onClick={handleSave}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-primary-mid bg-primary-weak px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary-weak transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Apply
                    </button>
                    <button
                      data-testid={`program-edit-cancel-${segment.segmentIndex}`}
                      onClick={handleCancel}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {feedback && (
        <div
          data-testid="program-edit-feedback"
          className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1.5 text-[10px]"
        >
          <span className="inline-flex items-center gap-1 rounded bg-green-600/15 px-1.5 py-0.5 font-semibold uppercase text-green-600">
            <Check className="h-3 w-3" />
            Applied
          </span>
          <span className="text-muted-foreground">Plan</span>
          <span className="font-mono text-foreground">{feedback.plan_id}</span>
          <span className="ml-auto text-muted-foreground">
            Health {(feedback.health_before * 100).toFixed(0)}% →{' '}
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {(feedback.health_after * 100).toFixed(0)}%
            </span>
          </span>
          <button
            data-testid="program-edit-undo"
            onClick={handleUndo}
            disabled={undoing}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Undo
          </button>
        </div>
      )}

      {error && (
        <div className="text-[10px] text-destructive bg-destructive-weak rounded px-2 py-1">{error}</div>
      )}
    </section>
  )
}

const BADGE_STYLES = {
  critical: 'bg-destructive-weak text-destructive',
  warning: 'bg-warning-weak text-chart-4',
  info: 'bg-muted text-muted-foreground',
  clean: 'bg-muted text-muted-foreground',
} as const

const BADGE_LABELS = { critical: 'Critical', warning: 'Warning', info: 'Info', clean: 'Info' } as const

function SeverityBadge({ tier }: { tier: keyof typeof BADGE_LABELS }) {
  return (
    <span
      data-testid="severity-badge"
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${BADGE_STYLES[tier]}`}
    >
      {BADGE_LABELS[tier]}
    </span>
  )
}
