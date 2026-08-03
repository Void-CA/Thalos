import { Outlet } from 'react-router'
import { TopBar } from './top-bar'
import { StatusBar } from './status-bar'
import { Viewport } from '@/features/viewport/viewport'
import { useSceneRobotSync } from '@/features/viewport/synchronization/use-scene-robot-sync'

/**
 * AppShell — layout route (thin coordinator).
 *
 * TopBar + Viewport + StatusBar stay mounted OUTSIDE the <Outlet/>; only the
 * workspace panel changes inside it. This is what guarantees invariant #1: the
 * 3D viewport never unmounts when navigating between workspaces.
 *
 * The coordinator performs no domain operations and knows nothing about the
 * workspaces: the active workspace is resolved by the router from the
 * registry-driven route config.
 */
export function AppShell() {
  // Robot selection → scene loader sync (viewport lifecycle, stays mounted).
  useSceneRobotSync()

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <TopBar />

      {/* Body: workspace panel (Outlet) + persistent viewport */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-shrink-0 w-[380px] overflow-hidden">
          <Outlet />
        </main>
        <div className="flex-1 relative overflow-hidden">
          <Viewport />
        </div>
      </div>

      <StatusBar />
    </div>
  )
}
