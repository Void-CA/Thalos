import { useCallback, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { usePlanningStore, type SegmentModel } from '../store'
import { useSceneStore } from '@/features/viewport/store'
import { sceneApi } from '@/features/viewport/api/scene-api'
import { toSceneData, toRuntimeInfo, toIkResult, toActivePlan, toToolFrame, toExecutionInfo } from '@/features/viewport/adapter'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import { useAnalysisStore } from '@/features/analysis/store'
import { useExecutionStore } from '@/features/execution/execution-store'
import type { RuntimeStateResponse } from '@/features/viewport/api/scene-api.types'
import { Loader2, Plus, Trash2, Play, ChevronDown, ChevronRight } from 'lucide-react'
import { PLAN_SEGMENT_PALETTE } from '@/shared/tokens'

type MotionSegmentDto =
  | { type: 'movej'; target: number[] }
  | { type: 'movel'; target: { translation: [number, number, number]; rotation: any } }

/**
 * Plan metadata mirrored into the execution store after a successful preview
 * (PR2, motion-program spec): instruction count = previewed segments; duration
 * = the last segment's end time (segments are sequential). Pure — the handoff
 * mirrors the plan, it never re-derives it from the backend runtime.
 */
export function planSummaryFromPreview(scene: RuntimeStateResponse): { instructionCount: number; durationSecs: number } {
  const segments = scene.active_plan?.segments ?? []
  const instructionCount = segments.length
  const durationSecs = segments.length > 0 ? segments[segments.length - 1].time_end : 0
  return { instructionCount, durationSecs }
}

function buildRequest(segments: SegmentModel[], dof: number): { segments: MotionSegmentDto[] } {
  const segs: MotionSegmentDto[] = []
  for (const seg of segments) {
    if (seg.kind === 'movej') {
      segs.push({ type: 'movej', target: seg.joints.length === dof ? seg.joints : new Array(dof).fill(0) })
    } else {
      const t: [number, number, number] = [
        parseFloat(seg.txStr) || 0, parseFloat(seg.tyStr) || 0, parseFloat(seg.tzStr) || 0,
      ]
      const r = seg.rotationFormat === 'euler'
        ? { kind: 'Ypr' as const, value: { yaw: (parseFloat(seg.yawStr)||0)*Math.PI/180, pitch: (parseFloat(seg.pitchStr)||0)*Math.PI/180, roll: (parseFloat(seg.rollStr)||0)*Math.PI/180 } }
        : { kind: 'Quaternion' as const, value: { w: parseFloat(seg.qwStr)||1, x: parseFloat(seg.qxStr)||0, y: parseFloat(seg.qyStr)||0, z: parseFloat(seg.qzStr)||0 } }
      segs.push({ type: 'movel', target: { translation: t, rotation: r } })
    }
  }
  return { segments: segs }
}

function usePlanPreview() {
  const dof = useSceneStore(s => s.runtime?.robot.dof ?? 0)
  const applyScene = useSceneStore(s => s.applyScene)
  const setAnalysis = useAnalysisStore(s => s.setAnalysis)

  return useMutation({
    mutationFn: async (segments: SegmentModel[]) => {
      // 1. Preview (compile + visualize)
      const res = await sceneApi.previewPlan(buildRequest(segments, dof))
      // 2. Auto-analyze (matching Angular behavior)
      const analysis = await planAnalysisApi.analyze()
      return { scene: res, analysis }
    },
    onSuccess: ({ scene, analysis }) => {
      applyScene(
        toSceneData(scene.scene),
        toRuntimeInfo(scene),
        toIkResult(scene.ik_result),
        toActivePlan(scene.active_plan),
        toToolFrame(scene.active_tcp),
        toExecutionInfo(scene.execution),
      )
      setAnalysis(analysis)
      // Handoff (Invariant #5, motion-program spec): mirror the previewed plan
      // into the execution store — source 'Motion Program' — WITHOUT touching
      // the backend runtime. Sets execStatus = ready; the tick loop does NOT
      // start here (only start() from the Execution workspace begins it).
      const { instructionCount, durationSecs } = planSummaryFromPreview(scene)
      useExecutionStore.getState().receivePlan({ instructionCount, durationSecs, source: 'Motion Program' })
    },
  })
}

/**
 * PlanningPanel — editor de programas de movimiento.
 * Matching Angular PlanningPanel + PlanningWorkspace.
 */
export function PlanningPanel() {
  const dof = useSceneStore(s => s.runtime?.robot.dof ?? 0)
  const segments = usePlanningStore(s => s.segments)
  const addSegment = usePlanningStore(s => s.addSegment)
  const removeSegment = usePlanningStore(s => s.removeSegment)
  const toggleSegment = usePlanningStore(s => s.toggleSegment)
  const updateJoints = usePlanningStore(s => s.updateSegmentJoints)
  const updateField = usePlanningStore(s => s.updateField)
  const clear = usePlanningStore(s => s.clear)
  const [error, setError] = useState<string | null>(null)

  const preview = usePlanPreview()

  const handlePreview = useCallback(() => {
    if (segments.length === 0) return
    setError(null)
    preview.mutate(segments)
  }, [segments, preview])

  const handleError = preview.error
    ? (preview.error as Error).message
    : error

  return (
    <div className="flex flex-col gap-3">
      {segments.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4 px-2 bg-secondary/20 rounded-lg border border-border/50">
          No segments. Add a motion command to build a program.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {segments.map((seg, i) => (
          <SegmentCard
            key={i}
            segment={seg}
            index={i}
            color={PLAN_SEGMENT_PALETTE[i % PLAN_SEGMENT_PALETTE.length]}
            dof={dof}
            onToggle={() => toggleSegment(i)}
            onRemove={() => removeSegment(i)}
            onUpdateField={(field, value) => updateField(i, field, value)}
            onUpdateJoints={(joints) => updateJoints(i, joints)}
          />
        ))}
      </div>

      <div className="flex gap-1.5">
        <button onClick={() => addSegment('movej', dof)} disabled={dof === 0}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary/30 transition-all cursor-pointer disabled:opacity-35">
          <Plus className="h-3.5 w-3.5" /> MoveJ
        </button>
        <button onClick={() => addSegment('movel', dof)} disabled={dof === 0}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary/30 transition-all cursor-pointer disabled:opacity-35">
          <Plus className="h-3.5 w-3.5" /> MoveL
        </button>
      </div>

      <div className="flex gap-1.5">
        <button onClick={handlePreview} disabled={segments.length === 0 || preview.isPending}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-primary-mid bg-primary-weak text-primary hover:bg-primary-weak hover:border-primary-strong transition-all cursor-pointer disabled:opacity-35">
          {preview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {preview.isPending ? 'Compiling…' : 'Preview'}
        </button>
        {segments.length > 0 && (
          <button onClick={clear}
            className="px-2 py-2 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive-mid transition-all cursor-pointer"
            title="Clear all segments">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {handleError && (
        <div className="text-xs text-destructive bg-destructive-weak border border-destructive-weak rounded-lg px-3 py-2">
          {handleError}
        </div>
      )}
    </div>
  )
}

// ── SegmentCard ──

function SegmentCard({ segment, index, color, dof, onToggle, onRemove, onUpdateField, onUpdateJoints }: {
  segment: SegmentModel; index: number; color: string; dof: number
  onToggle: () => void; onRemove: () => void
  onUpdateField: <K extends keyof SegmentModel>(field: K, value: SegmentModel[K]) => void
  onUpdateJoints: (joints: number[]) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div onClick={onToggle} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/30 transition-colors select-none">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-xs font-medium text-foreground flex-1">Segment {index + 1} — {segment.kind === 'movej' ? 'MoveJ' : 'MoveL'}</span>
        {segment.expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <button onClick={(e) => { e.stopPropagation(); onRemove() }} className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {segment.expanded && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-3">
          {segment.kind === 'movej' ? (
            <MoveJEditor segment={segment} dof={dof} onChange={onUpdateJoints} />
          ) : (
            <MoveLEditor segment={segment} onUpdateField={onUpdateField} />
          )}
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-muted-foreground">Velocity (optional)</span>
            <input type="number" step={0.1} min={0.01} placeholder="default"
              value={segment.velocityStr}
              onChange={e => onUpdateField('velocityStr', e.target.value)}
              className="w-full text-xs font-mono bg-input border border-border rounded-md px-2 py-1 text-left tabular-nums focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring-weak [appearance:textfield]" />
          </label>
        </div>
      )}
    </div>
  )
}

// ── MoveJ Editor ──

function MoveJEditor({ segment, dof, onChange }: {
  segment: SegmentModel; dof: number; onChange: (joints: number[]) => void
}) {
  const vals = segment.joints.length === dof ? segment.joints : new Array(dof).fill(0)
  const runtime = useSceneStore(s => s.runtime)
  const meta = runtime?.robot.joints ?? []

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: dof }).map((_, i) => {
        const j = meta[i]; const min = j?.min ?? -Math.PI; const max = j?.max ?? Math.PI
        const name = j?.name ?? `J${i + 1}`; const val = vals[i] ?? 0
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0
        return (
          <div key={name} className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground w-8 truncate">{name}</span>
            <div className="relative flex-1 h-4 flex items-center">
              <input type="range" min={min} max={max} step={0.01} value={val}
                onChange={e => { const n = [...vals]; n[i] = +e.target.value; onChange(n) }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="w-full h-1 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-primary-strong" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
              </div>
            </div>
            <input type="number" min={min} max={max} step={0.01} value={val}
              onChange={e => { const n = [...vals]; n[i] = +e.target.value; onChange(n) }}
              className="w-16 text-[10px] font-mono bg-input border border-border rounded px-1.5 py-0.5 text-left tabular-nums focus:outline-none focus:border-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
        )
      })}
    </div>
  )
}

// ── MoveL Editor ──

function MoveLEditor({ segment, onUpdateField }: {
  segment: SegmentModel
  onUpdateField: <K extends keyof SegmentModel>(field: K, value: SegmentModel[K]) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className="text-[10px] font-medium text-muted-foreground mb-1 block">Translation</span>
        <div className="grid grid-cols-3 gap-1.5">
          {(['X', 'Y', 'Z'] as const).map((label, i) => {
            const field = ['txStr', 'tyStr', 'tzStr'][i] as 'txStr' | 'tyStr' | 'tzStr'
            return (
              <label key={label} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <input type="number" step={0.01} value={segment[field]}
                  onChange={e => onUpdateField(field, e.target.value)}
                  className="w-full text-xs font-mono bg-input border border-border rounded-md px-2 py-1 text-left tabular-nums focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring-weak [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </label>
            )
          })}
        </div>
      </div>
      <div>
        <span className="text-[10px] font-medium text-muted-foreground mb-1 block">Rotation</span>
        <div className="flex rounded-md border border-border overflow-hidden mb-1.5">
          {[{ k: 'euler' as const, l: 'Euler' }, { k: 'quaternion' as const, l: 'Quat' }].map(f => (
            <button key={f.k} onClick={() => onUpdateField('rotationFormat', f.k)}
              className={`flex-1 px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${segment.rotationFormat === f.k ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
              {f.l}
            </button>
          ))}
        </div>
        {segment.rotationFormat === 'euler' ? (
          <div className="grid grid-cols-3 gap-1.5">
            {[['Yaw °Z', 'yawStr'], ['Pitch °Y', 'pitchStr'], ['Roll °X', 'rollStr']].map(([label, field]) => (
              <label key={field} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <input type="number" step={1} value={segment[field as keyof SegmentModel] as string}
                  onChange={e => onUpdateField(field as any, e.target.value)}
                  className="w-full text-xs font-mono bg-input border-border rounded-md px-2 py-1 text-left tabular-nums focus:outline-none focus:border-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </label>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {['qwStr', 'qxStr', 'qyStr', 'qzStr'].map((field, i) => (
              <label key={field} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-muted-foreground">{['W', 'X', 'Y', 'Z'][i]}</span>
                <input type="number" step={0.01} value={segment[field as keyof SegmentModel] as string}
                  onChange={e => onUpdateField(field as any, e.target.value)}
                  className="w-full text-xs font-mono bg-input border-border rounded-md px-2 py-1 text-left tabular-nums focus:outline-none focus:border-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
