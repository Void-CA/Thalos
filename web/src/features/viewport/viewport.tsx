import { useSceneStore } from './store'
import { SceneCanvas } from './renderer/scene-canvas'
import { Loader2 } from 'lucide-react'

/**
 * Viewport — contenedor principal del visor 3D.
 *
 * Cuando no hay robot cargado muestra un placeholder.
 * Cuando está cargando muestra un spinner.
 * Cuando hay datos renderiza el canvas R3F con todos los overlays.
 */
export function Viewport() {
  const loading = useSceneStore(s => s.loading)
  const error = useSceneStore(s => s.error)
  const hasData = useSceneStore(s => s.data !== null)

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive">
        <p className="text-sm font-medium">{error}</p>
      </div>
    )
  }

  if (loading && !hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-2" />
        <p className="text-sm">Loading scene...</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <SceneCanvas />

      {/* Toolbar flotante sobre el canvas */}
      {hasData && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            className="px-2 py-1 text-[11px] font-medium rounded bg-background/80 border border-border 
                       text-foreground/70 hover:text-foreground hover:bg-background transition-colors
                       backdrop-blur-sm cursor-pointer"
            onClick={() => {
              // TODO: fit robot to view
            }}
          >
            Fit Robot
          </button>
        </div>
      )}
    </div>
  )
}
