import { useSceneStore } from '../store'

/**
 * TCP Panel — información del Tool Center Point activo.
 *
 * Matching Angular (TcpInfoPanel):
 *   - Muestra base frame ID
 *   - Muestra offset si existe, o "identity (at frame)" si no
 *   - Mensaje "No TCP selected — using flange" cuando no hay TCP
 */
export function TcpPanel() {
  const activeTcp = useSceneStore(s => s.activeTcp)

  if (!activeTcp) {
    return (
      <div className="px-1 py-4 text-xs text-muted-foreground text-center">
        No TCP selected — using flange
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Base frame</span>
        <span className="text-xs font-mono text-foreground">#{activeTcp.baseFrameId}</span>
      </div>

      <div className="flex items-start justify-between">
        <span className="text-xs text-muted-foreground">Offset</span>
        {activeTcp.offset ? (
          <span className="text-xs font-mono text-foreground tabular-nums text-right">
            X: {activeTcp.offset[0].toFixed(3)}<br />
            Y: {activeTcp.offset[1].toFixed(3)}<br />
            Z: {activeTcp.offset[2].toFixed(3)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">identity (at frame)</span>
        )}
      </div>
    </div>
  )
}
