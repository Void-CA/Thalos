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
  // Budget de reintento automático: permite a lo sumo UN re-request tras un
  // fallo por selección. Sin este flag, resetear lastRequested en cada flip de
  // isError re-disparaba el efecto de request (el objeto useMutation es fresco
  // por render) → bucle infinito de POST /scene/robot (CRITICAL R3-001).
  const retriedAfterError = useRef(false)

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

  // Cuando el usuario cambia de selección, el budget de reintento se reinicia
  // y el latch se limpia: una selección distinta (o una deselección) habilita
  // de nuevo el reintento automático del robot fallido.
  useEffect(() => {
    if (selectedId !== lastRequested.current) {
      retriedAfterError.current = false
      lastRequested.current = null
    }
  }, [selectedId])

  // Error settle: permite UN reintento automático por selección (fix CRITICAL
  // R3-001). Un loadRobot(X) fallido nunca cambia confirmedId, así que el reset
  // por identidad confirmada jamás desbloquea X (selectedId === lastRequested === X).
  // Un request fallido no debe envenenar la re-selección — pero tampoco debe
  // bombardear el backend: tras el primer reintento, retriedAfterError=true y el
  // latch permanece, cortando el bucle hasta que el usuario cambie de selección.
  useEffect(() => {
    if (loadRobot.isError && !retriedAfterError.current) {
      retriedAfterError.current = true
      lastRequested.current = null
    }
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
