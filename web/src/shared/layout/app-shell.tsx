import { Outlet, useLocation } from 'react-router'
import { TopBar } from './top-bar'
import { StatusBar } from './status-bar'
import { Stepper } from '@/stepper'
import { Viewport } from '@/features/viewport/viewport'
import { WORKSPACE_REGISTRY } from '@/shared/workflow/registry'
import { useSceneRobotSync } from '@/features/viewport/synchronization/use-scene-robot-sync'

/**
 * AppShell — layout route (thin coordinator).
 *
 * TopBar + Stepper + Viewport + StatusBar stay mounted OUTSIDE the <Outlet/>;
 * only the workspace panel changes inside it. This is what guarantees invariant
 * #1: the 3D viewport never unmounts when navigating between workspaces, and
 * the stepper keeps showing the workflow position across transitions.
 *
 * HOTFIX (evaluation-workspace): the active workspace's registry `layout`
 * field selects the shell body shape — default 'panel' renders the workspace
 * beside the persistent viewport; 'full' (used by /evaluation) drops the
 * viewport so the workspace IS the focus. This is a DELIBERATE, documented
 * exception to invariant #1: the pre-execution decision must not compete with
 * the 3D view, so the viewport unmounts while /evaluation is active.
 *
 * The coordinator performs no domain operations and knows nothing about the
 * workspaces: the active workspace and its layout are resolved from the
 * registry by path (single source of truth).
 */
export function AppShell() {
  // Robot selection → scene loader sync (viewport lifecycle, stays mounted).
  useSceneRobotSync()
  const { pathname } = useLocation()
  const entry = WORKSPACE_REGISTRY.find((e) => e.path === pathname)
  const fullWidth = entry?.layout === 'full'

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <TopBar />
      <Stepper />

      {/* Body: workspace panel (Outlet) + persistent viewport (or full-width
          workspace for layout 'full' areas — evaluation drops the viewport). */}
      <div className="flex flex-1 overflow-hidden">
        {fullWidth ? (
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        ) : (
          <>
            <main className="flex-shrink-0 w-[380px] overflow-hidden">
              <Outlet />
            </main>
            <div className="flex-1 relative overflow-hidden">
              <Viewport />
            </div>
          </>
        )}
      </div>

      <StatusBar />
    </div>
  )
}
