import { SceneEditor } from './components/scene-editor'

/**
 * Scene area (area-scene spec: "Scene Panel Full-Height", design D4).
 *
 * The SceneWorkspace is the EXCLUSIVE owner of the Scene editor — the
 * Programming workspace no longer renders Scene editing UI (S2). The
 * editor occupies the full panel height with no collapsible `<details>`
 * wrapper: the Scene is a first-class domain area, not a Task sub-panel.
 */
export function SceneWorkspace() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SceneEditor />
    </div>
  )
}
