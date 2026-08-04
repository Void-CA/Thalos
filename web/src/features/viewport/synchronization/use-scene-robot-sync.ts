import { useEffect, useRef } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useLoadRobot } from './use-scene-loader'

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
  const loadRobot = useLoadRobot()
  const confirmedId = useSceneStore(s => s.runtime?.robot.id ?? null)
  const lastRequested = useRef<string | null>(null)

  useEffect(() => {
    // Dedupe: skip robots already confirmed by the scene (applyScene response)
    // or already requested — a URDF import changing the scene identity must
    // not trigger a spurious reload of the last catalog selection.
    if (selectedId && selectedId !== confirmedId && selectedId !== lastRequested.current) {
      lastRequested.current = selectedId
      loadRobot.mutate(selectedId)
    }
  }, [selectedId, confirmedId, loadRobot])
}
