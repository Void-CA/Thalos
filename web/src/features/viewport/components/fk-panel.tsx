import { memo, useEffect, useRef } from 'react'
import { useSceneStore } from '../store'
import { useFkStream } from '../synchronization/use-fk-stream'

/**
 * FK Panel — Forward Kinematics joint control.
 *
 * Optimizado: los slider rows son React.memo y la función onChange
 * se mantiene estable via ref para no romper la memoización.
 */
export function FkPanel() {
  const runtime = useSceneStore(s => s.runtime)
  const fkMutation = useFkStream()
  const localValues = useRef<number[]>([])

  const joints = runtime?.robot.joints ?? []
  const runtimeValues = runtime?.joints ?? []

  // Solo sincronizar del store cuando cambia el DOF (robot nuevo)
  const prevDof = useRef(0)
  useEffect(() => {
    const dof = joints.length
    if (dof > 0 && dof !== prevDof.current) {
      prevDof.current = dof
      localValues.current = [...runtimeValues]
    }
  }, [joints.length, runtimeValues])

  // Ref mutable: debounce 16ms (~60fps) para no saturar la API
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendFkRef = useRef<(values: number[]) => void>(() => {})
  sendFkRef.current = (values) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { fkMutation.mutate(values) }, 16)
  }

  if (!runtime) {
    return (
      <div className="px-1 py-6 text-xs text-muted-foreground text-center">
        Load a robot to adjust joints
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {joints.map((j, i) => {
        const val = localValues.current[i] ?? runtimeValues[i] ?? 0
        return (
          <SliderRow
            key={j.name}
            name={j.name}
            value={val}
            min={j.min ?? -Math.PI}
            max={j.max ?? Math.PI}
            index={i}
            onChange={(idx, v) => {
              localValues.current[idx] = v
              sendFkRef.current([...localValues.current])
            }}
          />
        )
      })}
      {fkMutation.isPending && (
        <div className="text-[10px] text-muted-foreground text-center italic">updating…</div>
      )}
    </div>
  )
}

// ── SliderRow memoizado ──

interface SliderRowProps {
  name: string
  value: number
  min: number
  max: number
  index: number
  onChange: (index: number, value: number) => void
}

const SliderRow = memo(function SliderRow({
  name, value, min, max, index, onChange,
}: SliderRowProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground/80 font-mono">{name}</span>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {value >= 0 ? '+' : ''}{value.toFixed(3)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-5 flex items-center">
          <input
            type="range"
            min={min}
            max={max}
            step={0.001}
            defaultValue={value}
            onChange={e => onChange(index, +e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60 transition-none"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
        </div>
        <input
          type="number"
          min={min}
          max={max}
          step={0.01}
          value={value}
          onChange={e => onChange(index, +e.target.value)}
          className="w-20 text-xs font-mono bg-input border border-border rounded-md
                     px-2 py-1 text-left tabular-nums
                     focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/30
                     [appearance:textfield]
                     [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </div>
  )
})
