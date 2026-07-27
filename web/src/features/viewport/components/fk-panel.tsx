import { useEffect, useRef } from 'react'
import { useSceneStore } from '../store'
import { useFkStream } from '../synchronization/use-fk-stream'

/**
 * FK Panel — Forward Kinematics joint control.
 *
 * Lee joints y runtime del store directo. Se re-renderiza en cada
 * respuesta FK, pero es barato (~6 sliders). El throttle evita
 * saturar la API durante el arrastre.
 */
export function FkPanel() {
  const fkMutation = useFkStream()
  const runtime = useSceneStore(s => s.runtime)
  const joints = runtime?.robot.joints ?? []
  const runtimeValues = runtime?.joints ?? []
  const localValues = useRef<number[]>([])

  // Sincroniza localValues cuando cambia el robot (por identidad, no solo DOF)
  const robotKey = runtime?.robot.id ?? ''
  const prevKey = useRef('')
  useEffect(() => {
    if (robotKey && robotKey !== prevKey.current) {
      prevKey.current = robotKey
      localValues.current = [...runtimeValues]
    }
  }, [robotKey, runtimeValues])

  // ── Throttle con trailing (matching auditTime(16) de Angular) ──
  const lastCall = useRef(0)
  const pending = useRef<number[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleFk = (values: number[]) => {
    const now = Date.now()
    const elapsed = now - lastCall.current

    if (elapsed >= 16) {
      lastCall.current = now
      pending.current = null
      fkMutation.mutate(values)
    } else {
      pending.current = values
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null
          if (pending.current) {
            lastCall.current = Date.now()
            fkMutation.mutate(pending.current)
            pending.current = null
          }
        }, 16 - elapsed)
      }
    }
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
            onChange={(v) => {
              localValues.current[i] = v
              scheduleFk([...localValues.current])
            }}
          />
        )
      })}
    </div>
  )
}

// ── SliderRow ──

function SliderRow({
  name, value, min, max, onChange,
}: {
  name: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
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
            value={value}
            onChange={e => onChange(+e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary-strong"
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
          onChange={e => onChange(+e.target.value)}
          className="w-20 text-xs font-mono bg-input border border-border rounded-md
                     px-2 py-1 text-left tabular-nums
                     focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring-weak
                     [appearance:textfield]
                     [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </div>
  )
}
