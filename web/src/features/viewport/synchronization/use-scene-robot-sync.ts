import { useEffect, useRef } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useLoadRobot, useLoadScene } from './use-scene-loader'

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
  const loadScene = useLoadScene()
  const confirmedId = useSceneStore(s => s.runtime?.robot.id ?? null)
  const lastRequested = useRef<string | null>(null)
  const initialSceneRequested = useRef(false)

  // Invalida el dedupe latch cuando cambia la identidad confirmada (fix review):
  // el flujo "select scara → importar URDF → re-seleccionar scara" quedaba
  // silenciosamente ignorado porque selectedId('scara') === lastRequested, aun
  // cuando confirmedId ya no era scara. Corre ANTES que el efecto de request
  // para que una re-selección distinta se re-solicite en el mismo commit. El
  // guard no depende de confirmedId truthy: también invalida cuando la identidad
  // confirmada pasa a null/falsy (escena reseteada).
  useEffect(() => {
    if (confirmedId !== lastRequested.current) {
      lastRequested.current = null
    }
  }, [confirmedId])

  // Invalida el dedupe latch cuando un load settle con ERROR (fix review F1):
  // un loadRobot(X) fallido nunca cambia confirmedId, así que el reset por
  // identidad confirmada jamás desbloquea X (selectedId === lastRequested === X).
  // Un request fallido no debe envenenar la re-selección. Corre ANTES que el
  // efecto de request para que el latch esté limpio en el mismo commit.
  useEffect(() => {
    if (loadRobot.isError) lastRequested.current = null
  }, [loadRobot.isError])

  useEffect(() => {
    // Dedupe: skip robots already confirmed by the scene (applyScene response)
    // or already requested — a URDF import changing the scene identity must
    // not trigger a spurious reload of the last catalog selection.
    if (selectedId && selectedId !== confirmedId && selectedId !== lastRequested.current) {
      lastRequested.current = selectedId
      loadRobot.mutate(selectedId)
    }
  }, [selectedId, confirmedId, loadRobot])

  // Spec R7/R6 — backend-derived default. GET /scene se dispara siempre que NO
  // haya identidad confirmada ni un request de identidad en vuelo, INDEPENDIENTE
  // del hint persistido (fix review): el hint es solo una REQUEST vía el
  // select() de RobotSelector — montado únicamente en /task — nunca la única
  // vía de carga. Sin esto, arrancar en '/' con un hint persistido dejaba la
  // escena sin cargar (viewport vacío y redirect a '/'), y un fallo de GET
  // /robots también bloqueaba la escena. El load extra de GET /scene es seguro:
  // use-scene-loader descarta respuestas stale vía tokens de orden.
  useEffect(() => {
    if (confirmedId) return
    if (loadScene.isPending || loadRobot.isPending) return
    if (initialSceneRequested.current) return
    initialSceneRequested.current = true
    loadScene.mutate()
  }, [confirmedId, loadScene.isPending, loadRobot.isPending, loadScene])
}
