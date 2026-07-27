import { usePerspectiveStore } from './perspective-store'
import { useLayoutStore } from './layout-store'
import { TopBar } from './top-bar'
import { StatusBar } from './status-bar'
import { RobotCatalog } from '@/features/robots/components/robot-catalog'
import { Viewport } from '@/features/viewport/viewport'
import { useSceneRobotSync } from '@/features/viewport/synchronization/use-scene-robot-sync'
import { TOOLS_BY_PERSPECTIVE } from '@/features/viewport/components/tools-registry'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'

/**
 * App shell — layout principal con perspectiva activa.
 *
 * Robot (default):
 *   [top-bar]
 *   [left-panel | scene-viewer | right-panel (tools)]
 *   [status-bar]
 *
 * Analysis / Planning / etc: workspaces full-width en vez de right panel.
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
  const tools = TOOLS_BY_PERSPECTIVE[perspective] ?? []

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <TopBar />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ── */}
        {perspective === 'robot' && (
          <>
            <div
              className="flex-shrink-0 border-r border-border bg-sidebar overflow-hidden transition-all duration-150"
              style={{ width: effectiveLeft }}
            >
              {!leftCollapsed ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Robots
                    </span>
                    <button
                      onClick={toggleLeft}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      ◀
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    <RobotCatalog />
                  </div>
                </div>
              ) : (
                <button
                  onClick={toggleLeft}
                  className="w-full flex items-center justify-center py-2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  ▶
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Scene viewport (siempre ocupa el centro) ── */}
        <div className="flex-1 relative overflow-hidden">
          <Viewport />
        </div>

        {/* ── Right panel (tools) ── */}
        {perspective === 'robot' && tools.length > 0 && (
          <div
            className="flex-shrink-0 border-l border-border bg-sidebar overflow-hidden transition-all duration-150"
            style={{ width: effectiveRight }}
          >
            {!rightCollapsed ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tools
                  </span>
                  <button
                    onClick={toggleRight}
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    ▶
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <Accordion
                    className="w-full"
                    defaultValue={tools.filter(t => t.defaultOpen).map(t => t.id)}
                  >
                    {tools.map(tool => (
                      <AccordionItem key={tool.id} value={tool.id} className="border-b border-border last:border-b-0">
                        <AccordionTrigger className="px-3 py-2 pr-2 text-xs font-semibold text-foreground hover:no-underline hover:bg-accent/40 cursor-pointer [&>svg]:text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">
                          {tool.label}
                        </AccordionTrigger>
                        <AccordionContent className="px-3 pb-3 pt-1.5">
                          <tool.component />
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              </div>
            ) : (
              <button
                onClick={toggleRight}
                className="w-full flex items-center justify-center py-2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ◀
              </button>
            )}
          </div>
        )}

        {/* ── Full-width workspace views ── */}
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

      <StatusBar />
    </div>
  )
}
