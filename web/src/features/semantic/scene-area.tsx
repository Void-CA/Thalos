import { SceneEditor } from './components/scene-editor'

/**
 * Escena area (S1 placeholder) — projects the Scene artifact full-height via
 * the existing SceneEditor. S2 relocates this to `features/scene/SceneWorkspace`
 * and removes the inline Scene panel from the Programación workspace.
 */
export function SceneArea() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SceneEditor />
    </div>
  )
}
