import { useState, useEffect } from 'react'
import { useSceneStore } from '../store'
import { useSceneService } from '../services/service-context'

/**
 * TCP Panel — selección del Tool Center Point activo.
 *
 * Matching Angular (TcpInfoPanel):
 *   - Selector de frame base (desde scene.frames) + inputs de offset
 *   - Muestra la resolved_pose del backend (FK) cuando el TCP está activo
 *   - Mensaje "No TCP selected — using flange" cuando no hay TCP
 *
 * El POST /scene/tcp ocurre al cambiar el selector (R2): el offset actual de
 * los inputs viaja con la selección; la opción vacía limpia el TCP.
 */
export function TcpPanel() {
  const service = useSceneService()
  const applyScene = useSceneStore(s => s.applyScene)
  const activeTcp = useSceneStore(s => s.activeTcp)
  const data = useSceneStore(s => s.data)

  const [frameId, setFrameId] = useState<string>('')
  const [offset, setOffset] = useState<[number, number, number]>([0, 0, 0])
  const [busy, setBusy] = useState(false)

  // Sync the local form with the store's active TCP (after selection or any
  // external scene refresh).
  useEffect(() => {
    if (activeTcp) {
      setFrameId(String(activeTcp.baseFrameId))
      setOffset(activeTcp.offset ?? [0, 0, 0])
    } else {
      setFrameId('')
      setOffset([0, 0, 0])
    }
  }, [activeTcp])

  const handleSelect = async (value: string) => {
    if (busy) return
    setBusy(true)
    try {
      const snapshot = value === ''
        ? await service.selectToolFrame(null)
        : await service.selectToolFrame(Number(value), offset)
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  const selectableFrames = data.frames.filter((f) => Number.isFinite(Number(f.id)))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Base frame</span>
        <select
          aria-label="TCP base frame"
          className="w-28 rounded border border-border bg-background px-1 py-0.5 text-xs font-mono text-foreground"
          value={frameId}
          onChange={(e) => handleSelect(e.target.value)}
          disabled={busy}
        >
          <option value="">Clear (no TCP)</option>
          {selectableFrames.map((f) => (
            <option key={f.id} value={f.id}>#{f.id}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Offset</span>
        <div className="flex gap-1">
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <input
              key={axis}
              type="number"
              step="0.01"
              aria-label={`Offset ${axis}`}
              className="w-14 rounded border border-border bg-background px-1 py-0.5 text-right text-xs font-mono text-foreground tabular-nums"
              value={Number.isFinite(offset[i]) ? offset[i] : 0}
              disabled={busy}
              onChange={(e) => {
                const next: [number, number, number] = [...offset]
                next[i] = Number(e.target.value)
                setOffset(next)
              }}
            />
          ))}
        </div>
      </div>

      {activeTcp?.resolvedPose && (
        <div data-testid="tcp-resolved-pose" className="flex items-start justify-between">
          <span className="text-xs text-muted-foreground">Resolved pose</span>
          <span className="text-xs font-mono text-foreground tabular-nums text-right">
            pos {activeTcp.resolvedPose.position[0].toFixed(3)} {activeTcp.resolvedPose.position[1].toFixed(3)} {activeTcp.resolvedPose.position[2].toFixed(3)}<br />
            rot {activeTcp.resolvedPose.orientation[0].toFixed(3)} {activeTcp.resolvedPose.orientation[1].toFixed(3)} {activeTcp.resolvedPose.orientation[2].toFixed(3)} {activeTcp.resolvedPose.orientation[3].toFixed(3)}
          </span>
        </div>
      )}

      {!activeTcp && (
        <div className="px-1 py-4 text-xs text-muted-foreground text-center">
          No TCP selected — using flange
        </div>
      )}
    </div>
  )
}
