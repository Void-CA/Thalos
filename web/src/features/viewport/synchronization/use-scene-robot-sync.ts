import { useEffect, useRef } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useLoadRobot, useLoadScene } from './use-scene-loader'
import { ROBOT_SELECTION_KEY } from '@/features/semantic/components/robot-selector'

/**
 * Sincroniza la selección de robot del catálogo con la escena 3D.
 *
 * La identidad CONFIRMADA del robot vive en el scene runtime, escrita
 * exclusivamente por `applyScene` (spec R2.1 — single writer). La selección
 * del catálogo es solo una REQUEST: cuando el usuario elige un robot que el
 * scene ya confirma, no se dispara ningún load.
 *
 * Cuando el usuario selecciona un robot en el catálogo, automáticamente
 * lo carga en el viewport vía la API (si el scene aún no lo confirma).
 */
export function useSceneRobotSync() {
  const selectedId = useRobotStore(s => s.selectedId)
  const robots = useRobotStore(s => s.robots)
  const loadRobot = useLoadRobot()
  const loadScene = useLoadScene()
  const confirmedId = useSceneStore(s => s.runtime?.robot.id ?? null)
  const lastRequested = useRef<string | null>(null)
  const initialLoadResolved = useRef(false)

  useEffect(() => {
    // Dedupe: skip robots already confirmed by the scene (applyScene response)
    // or already requested — a URDF import changing the scene identity must
    // not trigger a spurious reload of the last catalog selection.
    if (selectedId && selectedId !== confirmedId && selectedId !== lastRequested.current) {
      lastRequested.current = selectedId
      loadRobot.mutate(selectedId)
    }
  }, [selectedId, confirmedId, loadRobot])

  // Spec R7/R6 — backend-derived default. Once the catalog is known, request
  // GET /scene ONLY when no catalog hint is pending: fresh session (no
  // localStorage) or an unknown persisted id (select() ignores it). A valid
  // persisted catalog id is requested by RobotSelector's select() — firing
  // GET /scene here would race it and could clobber the request.
  useEffect(() => {
    if (initialLoadResolved.current) return
    if (robots.length === 0) return // wait for the catalog to validate the hint
    initialLoadResolved.current = true
    const persisted = localStorage.getItem(ROBOT_SELECTION_KEY)
    const persistedIsCatalog = persisted !== null && robots.some(r => r.id === persisted)
    if (!persistedIsCatalog && !confirmedId) loadScene.mutate()
  }, [robots, confirmedId, loadScene])
}
