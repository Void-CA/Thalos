import { useState, useCallback, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useSceneStore } from '../store'
import { useSceneService } from '../services/service-context'
import type { IkTarget } from '../types'
import type { RotationDto } from '../api/scene-api.types'
import { CheckCircle2, XCircle, Loader2, Eye, Cpu, Play } from 'lucide-react'
import { BTN_SOLVE_BG, BTN_EXECUTE_BG } from '@/shared/tokens'
import { ErrorBox } from '@/components/ui/error-box'

/**
 * IK Panel — Inverse Kinematics target control (3-step flow).
 *
 * Layout matching Angular (IkTargetPanel):
 *   1. Preview (gizmo only)  2. Solve (IK, no move)  3. Execute (solve + move)
 */
export function IkPanel() {
  const service = useSceneService()
  const applyScene = useSceneStore(s => s.applyScene)
  const setIkTarget = useSceneStore(s => s.setIkTarget)
  const ikTarget = useSceneStore(s => s.ikTarget)

  const [type, setType] = useState<'position' | 'pose'>('position')
  const [x, setX] = useState(0.5)
  const [y, setY] = useState(0.5)
  const [z, setZ] = useState(0.5)
  const [rotFormat, setRotFormat] = useState<'ypr' | 'quaternion'>('ypr')
  const [yawDeg, setYawDeg] = useState(0)
  const [pitchDeg, setPitchDeg] = useState(0)
  const [rollDeg, setRollDeg] = useState(0)
  const [qw, setQw] = useState(1)
  const [qx, setQx] = useState(0)
  const [qy, setQy] = useState(0)
  const [qz, setQz] = useState(0)

  useEffect(() => {
    if (ikTarget) {
      setX(ikTarget.translation[0])
      setY(ikTarget.translation[1])
      setZ(ikTarget.translation[2])
    }
  }, [ikTarget])

  const buildTarget = useCallback((): IkTarget => {
    if (type === 'position') {
      return { type: 'position', translation: [x, y, z] }
    }
    const rotation: RotationDto = rotFormat === 'ypr'
      ? { kind: 'Ypr', value: { yaw: yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180, roll: rollDeg * Math.PI / 180 } }
      : { kind: 'Quaternion', value: { w: qw, x: qx, y: qy, z: qz } }
    return { type: 'pose', translation: [x, y, z], rotation }
  }, [type, x, y, z, rotFormat, yawDeg, pitchDeg, rollDeg, qw, qx, qy, qz])

  const handlePreview = useCallback(() => setIkTarget(buildTarget()), [buildTarget, setIkTarget])

  const solveMutation = useMutation({
    mutationFn: async (target: IkTarget) => {
      if (target.type === 'pose' && target.rotation) {
        return service.solveIkPose({ translation: target.translation, rotation: target.rotation })
      }
      return service.solveIkPosition(target.translation)
    },
  })

  const handleSolve = useCallback(() => {
    const target = buildTarget()
    setIkTarget(target)
    solveMutation.mutate(target)
  }, [buildTarget, setIkTarget, solveMutation])

  const executeMutation = useMutation({
    mutationFn: async (target: IkTarget) => {
      if (target.type === 'pose' && target.rotation) {
        return service.moveToPose({ translation: target.translation, rotation: target.rotation })
      }
      return service.moveToPosition(target.translation)
    },
    onSuccess: (snapshot) => {
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
    },
  })

  const handleExecute = useCallback(() => {
    const target = buildTarget()
    setIkTarget(target)
    executeMutation.mutate(target)
  }, [buildTarget, setIkTarget, executeMutation])

  const result = solveMutation.data
  const solveErr = solveMutation.error
  const execErr = executeMutation.error

  return (
    <div className="flex flex-col gap-3">
      {/* ── TARGET TYPE ── */}
      <SegmentedControl
        options={[
          { key: 'position', label: 'Position' },
          { key: 'pose', label: 'Pose' },
        ]}
        value={type}
        onChange={setType}
      />

      {/* ── COORDS ── */}
      <div className="grid grid-cols-3 gap-1.5">
        <CoordInput label="X" value={x} onChange={setX} />
        <CoordInput label="Y" value={y} onChange={setY} />
        <CoordInput label="Z" value={z} onChange={setZ} />
      </div>

      {/* ── ROTATION (solo Pose) ── */}
      {type === 'pose' && (
        <div className="flex flex-col gap-2 pt-1 border-t border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Rotation</span>
          <SegmentedControl
            options={[
              { key: 'ypr', label: 'Euler' },
              { key: 'quaternion', label: 'Quat' },
            ]}
            value={rotFormat}
            onChange={setRotFormat}
          />
          {rotFormat === 'ypr' ? (
            <div className="grid grid-cols-3 gap-1.5">
              <CoordInput label="Yaw °Z" value={yawDeg} onChange={setYawDeg} step={1} />
              <CoordInput label="Pitch °Y" value={pitchDeg} onChange={setPitchDeg} step={1} />
              <CoordInput label="Roll °X" value={rollDeg} onChange={setRollDeg} step={1} />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              <CoordInput label="W" value={qw} onChange={setQw} step={0.01} />
              <CoordInput label="X" value={qx} onChange={setQx} step={0.01} />
              <CoordInput label="Y" value={qy} onChange={setQy} step={0.01} />
              <CoordInput label="Z" value={qz} onChange={setQz} step={0.01} />
            </div>
          )}
        </div>
      )}

      {/* ── ACTIONS ── */}
      <div className="grid grid-cols-3 gap-1.5">
        <ActionButton icon={Eye} label="Preview" onClick={handlePreview} variant="default" />
        <ActionButton
          icon={solveMutation.isPending ? Loader2 : Cpu}
          label={solveMutation.isPending ? 'Solving' : 'Solve'}
          onClick={handleSolve}
          variant="solve"
          disabled={solveMutation.isPending}
        />
        <ActionButton
          icon={executeMutation.isPending ? Loader2 : Play}
          label={executeMutation.isPending ? 'Moving' : 'Execute'}
          onClick={handleExecute}
          variant="execute"
          disabled={executeMutation.isPending}
        />
      </div>

      {/* ── SOLVED IK RESULT ── */}
      {result && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 border-b border-border">
            <span className="text-[11px] font-semibold text-foreground">Solved IK</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
              result.status === 'Converged'
                ? 'bg-success-weak text-chart-3'
                : 'bg-warning-weak text-chart-4'
            }`}>
              {result.status === 'Converged'
                ? <CheckCircle2 className="h-3 w-3" />
                : <XCircle className="h-3 w-3" />
              }
              {result.status}
            </span>
          </div>
          {/* Body */}
          <div className="p-3 flex flex-col gap-2">
            <div>
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1 block">Joint angles</span>
              <div className="text-[11px] font-mono text-foreground bg-secondary/40 rounded-md px-2 py-1.5 tabular-nums break-all leading-relaxed">
                [{result.joints.map((q: number) => q.toFixed(4)).join(', ')}]
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 bg-secondary/20 rounded-md px-2 py-1.5">
                <span className="text-[10px] text-muted-foreground">Iterations</span>
                <span className="text-sm font-mono font-semibold text-foreground tabular-nums">{result.iterations}</span>
              </div>
              <div className="flex flex-col gap-0.5 bg-secondary/20 rounded-md px-2 py-1.5">
                <span className="text-[10px] text-muted-foreground">Final Error</span>
                <span className="text-sm font-mono font-semibold text-foreground tabular-nums">{result.finalError.toExponential(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Errors */}
      {solveErr && <ErrorBox error={solveErr instanceof Error ? solveErr : 'Solve failed'} />}
      {execErr && <ErrorBox error={execErr instanceof Error ? execErr : 'Execute failed'} />}
    </div>
  )
}

// ── Sub-components ──

function SegmentedControl<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden bg-card">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer
            ${value === o.key
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function CoordInput({
  label, value, onChange, step,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        step={step ?? 0.01}
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

function ActionButton({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
  disabled,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number }>
  label: string
  onClick: () => void
  variant?: 'default' | 'solve' | 'execute'
  disabled?: boolean
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
  const style = variant === 'solve' ? { background: BTN_SOLVE_BG, borderColor: '#2a6ab0', color: '#fff' }
    : variant === 'execute' ? { background: BTN_EXECUTE_BG, borderColor: '#3a8a3a', color: '#fff' }
    : {}
  const cls = variant === 'default' ? 'bg-secondary text-foreground border-border hover:bg-accent' : ''
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`${base} ${cls}`}
    >
      {Icon && <Icon className={`h-3.5 w-3.5 ${disabled && Icon === Loader2 ? 'animate-spin' : ''}`} />}
      {label}
    </button>
  )
}
