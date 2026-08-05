import type { PoseDef } from '@/shared/contracts'

/**
 * Convert YPR euler angles (degrees) to a unit quaternion `[w, x, y, z]`.
 *
 * ZYX-intrinsic order — roll around X, then pitch around Y, then yaw around Z —
 * mirroring the backend `thalos_core::UnitQuaternion::from_euler` and the
 * `RotationDto::Ypr` wire contract (design D5). Storage is always quaternion;
 * YPR exists only at the UI boundary.
 */
export function yprToQuaternion(
  yawDeg: number,
  pitchDeg: number,
  rollDeg: number,
): [number, number, number, number] {
  const cr = Math.cos((rollDeg * Math.PI) / 360)
  const sr = Math.sin((rollDeg * Math.PI) / 360)
  const cp = Math.cos((pitchDeg * Math.PI) / 360)
  const sp = Math.sin((pitchDeg * Math.PI) / 360)
  const cy = Math.cos((yawDeg * Math.PI) / 360)
  const sy = Math.sin((yawDeg * Math.PI) / 360)

  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ]
}

/**
 * Convert a quaternion `[w, x, y, z]` back to YPR euler angles in degrees,
 * mirroring `UnitQuaternion::to_euler_angles`. Used to display the stored
 * orientation as human-editable YPR inputs.
 */
export function quaternionToYpr(orientation: [number, number, number, number]): {
  yaw: number
  pitch: number
  roll: number
} {
  const [w, x, y, z] = orientation
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
  const pitch = Math.asin(Math.min(1, Math.max(-1, 2 * (w * y - z * x))))
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
  const toDeg = (r: number) => (r * 180) / Math.PI
  return { yaw: toDeg(yaw), pitch: toDeg(pitch), roll: toDeg(roll) }
}

export interface PoseInputsProps {
  pose: PoseDef
  onChange: (pose: PoseDef) => void
  /** Prefix for the input aria-labels, e.g. the entity id → "bolt-1 Yaw". */
  idPrefix?: string
}

/**
 * Reusable pose editor (design D5): X/Y/Z position inputs plus Yaw/Pitch/Roll
 * orientation inputs. Orientation is converted YPR → quaternion `[w,x,y,z]`
 * for storage; the displayed angles are derived back from the quaternion so
 * the stored value is always the single source of truth.
 */
export function PoseInputs({ pose, onChange, idPrefix }: PoseInputsProps) {
  const prefix = idPrefix ?? 'pose'
  const label = (name: string) => `${prefix} ${name}`
  const euler = quaternionToYpr(pose.orientation)

  const setPosition = (axis: 0 | 1 | 2, value: number) => {
    const position = [...pose.position] as [number, number, number]
    position[axis] = value
    onChange({ ...pose, position })
  }

  const setAngle = (angle: 'yaw' | 'pitch' | 'roll', deg: number) => {
    onChange({
      ...pose,
      orientation: yprToQuaternion(
        angle === 'yaw' ? deg : euler.yaw,
        angle === 'pitch' ? deg : euler.pitch,
        angle === 'roll' ? deg : euler.roll,
      ),
    })
  }

  return (
    <div className="flex flex-col gap-0.5" role="group" aria-label={`${prefix} pose`}>
      <div className="flex items-center gap-1">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <div key={axis} className="flex items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground font-mono">{axis}</span>
            <input
              type="number"
              aria-label={label(axis)}
              value={pose.position[i]}
              onChange={(e) => setPosition(i as 0 | 1 | 2, parseFloat(e.target.value) || 0)}
              step={0.1}
              className="w-10 px-1 py-0.5 text-[10px] rounded border border-border bg-background
                         text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1">
        {(
          [
            ['Yaw', 'yaw'],
            ['Pitch', 'pitch'],
            ['Roll', 'roll'],
          ] as const
        ).map(([display, key]) => (
          <div key={key} className="flex items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground font-mono">{display}</span>
            <input
              type="number"
              aria-label={label(display)}
              value={Number(euler[key].toFixed(2))}
              onChange={(e) => setAngle(key, parseFloat(e.target.value) || 0)}
              step={1}
              className="w-11 px-1 py-0.5 text-[10px] rounded border border-border bg-background
                         text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
