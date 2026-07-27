import { usePerspectiveStore } from './perspective-store'
import { useLayoutStore } from './layout-store'
import { TopBar } from './top-bar'
import { StatusBar } from './status-bar'
import { RobotCatalog } from '@/features/robots/components/robot-catalog'
import { Viewport } from '@/features/viewport/viewport'
import { useSceneRobotSync } from '@/features/viewport/synchronization/use-scene-robot-sync'

/**
 * App shell — layout principal con perspectiva activa.
 *
 * Robot (default):
 *   [top-bar]
 *   [left-panel | scene-viewer | right-panel]
 *   [bottom-panel]
 *   [status-bar]
 *
 * Analysis / Planning / etc: se agregan workspaces como reemplazo del right panel.
 */
export function AppShell() {
  // Sync robot selection → scene loader
  useSceneRobotSync()

  const perspective = usePerspectiveStore(s => s.perspective)
  const {
    leftCollapsed, leftWidth,
    rightCollapsed, rightWidth,
    toggleLeft, toggleRight,
  } = useLayoutStore()

  const effectiveLeft = leftCollapsed ? 24 : leftWidth
  const effectiveRight = rightCollapsed ? 24 : rightWidth

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Top bar */}
      <TopBar />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        {perspective === 'robot' && (
          <>
            <div
              className="flex-shrink-0 border-r border-border bg-sidebar overflow-hidden transition-all duration-150"
              style={{ width: effectiveLeft }}
            >
              {!leftCollapsed && (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <div className="i-heroicons-cpu-chip h-5 w-5 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Robots
                    </span>
                    <button
                      onClick={toggleLeft}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    >
                      ◀
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    <RobotCatalog />
                  </div>
                </div>
              )}
              {leftCollapsed && (
                <button
                  onClick={toggleLeft}
                  className="w-full flex items-center justify-center py-2 text-muted-foreground hover:text-foreground"
                >
                  ▶
                </button>
              )}
            </div>
          </>
        )}

        {/* Scene viewport — siempre ocupa el centro */}
        <div className="flex-1 relative overflow-hidden bg-black/5">
          <Viewport />
        </div>

        {/* Right panel (tools) */}
        {perspective === 'robot' && (
          <div
            className="flex-shrink-0 border-l border-border bg-sidebar overflow-hidden transition-all duration-150"
            style={{ width: effectiveRight }}
          >
            {!rightCollapsed && (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <button onClick={toggleRight} className="text-xs text-muted-foreground hover:text-foreground">
                    ▶
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tools
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  <p className="text-xs text-muted-foreground">
                    Tool panels will render here
                  </p>
                </div>
              </div>
            )}
            {rightCollapsed && (
              <button
                onClick={toggleRight}
                className="w-full flex items-center justify-center py-2 text-muted-foreground hover:text-foreground"
              >
                ◀
              </button>
            )}
          </div>
        )}

        {/* Full-width workspace views (analysis, planning, etc.) */}
        {perspective === 'analysis' && (
          <div className="flex-1 border-l border-border bg-sidebar overflow-y-auto">
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-2">Analysis Workspace</h2>
              <p className="text-sm text-muted-foreground">
                Analysis content renders here.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <StatusBar />
    </div>
  )
}
