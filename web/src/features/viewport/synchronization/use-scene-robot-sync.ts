import { useEffect, useRef } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useLoadRobot, useLoadScene } from './use-scene-loader'

/**
 * Límite de re-arm automático del latch de GET /scene (fix review): si el boot
 * falla durablemente (retry: 1 del mutation agotado), `initialSceneRequested`
 * quedaba en true para siempre y un backend recuperado jamás volvía a
 * inicializar la escena. El re-arm concede reintentos acotados para que la
 * recuperación automática sea posible SIN que un backend caído produzca un
 * bucle infinito de re-fires.
 */
const MAX_SCENE_LOAD_REARMS = 2

/**
 * Decisión pura del efecto de request del sync hook (spec R2.1): ¿debe
 * dispararse un loadRobot para `selectedId` en este momento?
 *
 * La selección del catálogo es una REQUEST; la identidad confirmada vive en el
 * scene runtime (`confirmedId`), así que un robot ya confirmado nunca se
 * re-solicita. `lastRequestedId` es el latch de dedupe: el request en vuelo
 * para la selección actual. `autoRetrySpent` es el budget de reintento
 * automático (a lo sumo uno por selección tras un error): el error-settle
 * consume el budget y limpia el latch para conceder ese reintento, por eso un
 * latch limpio con budget gastado es EXACTAMENTE el estado de reintento
 * pendiente y el request se permite; un latch puesto con budget gastado es el
 * reintento agotado y se bloquea hasta que el usuario cambie de selección
 * (lo que resetea budget y latch juntos).
 */
export function shouldRequestRobot(
  selectedId: string | null,
  confirmedId: string | null,
  lastRequestedId: string | null,
  autoRetrySpent: boolean,
): boolean {
  if (!selectedId) return false
  if (selectedId === confirmedId) return false
  // Latch de dedupe: el request de esta selección ya fue emitido (en vuelo o
  // agotado tras error). Solo el error-settle (reintento concedido) o un cambio
  // de selección limpian el latch.
  if (selectedId === lastRequestedId) return false
  // Latch limpio → selección fresca o reintento concedido: ambos legítimos.
  // `autoRetrySpent` se lee para mantener explícito el contrato completo: un
  // budget gastado jamás debe coincidir con un latch limpio salvo justo tras el
  // error-settle que concedió el reintento (la defensa `lastRequestedId === null`
  // es la que permite ese caso único).
  return !autoRetrySpent || lastRequestedId === null
}

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
  const lastRequestedId = useRef<string | null>(null)
  const initialSceneRequested = useRef(false)
  // Re-arms de GET /scene consumidos: el re-arm concede a lo sumo
  // MAX_SCENE_LOAD_REARMS reintentos automáticos del latch inicial.
  const sceneLoadRearms = useRef(0)
  // Budget de reintento automático: permite a lo sumo UN re-request tras un
  // fallo por selección. Sin este flag, resetear lastRequestedId en cada flip
  // de isError re-disparaba el efecto de request (el objeto useMutation es
  // fresco por render) → bucle infinito de POST /scene/robot (CRITICAL R3-001).
  const autoRetrySpent = useRef(false)

  // Invalida el dedupe latch cuando cambia la identidad confirmada (fix review):
  // el flujo "select scara → importar URDF → re-seleccionar scara" quedaba
  // silenciosamente ignorado porque selectedId('scara') === lastRequestedId, aun
  // cuando confirmedId ya no era scara. Corre ANTES que el efecto de request
  // para que una re-selección distinta se re-solicite en el mismo commit. El
  // guard no depende de confirmedId truthy: también invalida cuando la identidad
  // confirmada pasa a null/falsy (escena reseteada).
  useEffect(() => {
    if (confirmedId !== lastRequestedId.current) {
      lastRequestedId.current = null
    }
  }, [confirmedId])

  // Cuando el usuario cambia de selección, el budget de reintento se reinicia
  // y el latch se limpia: una selección distinta (o una deselección) habilita
  // de nuevo el reintento automático del robot fallido.
  useEffect(() => {
    if (selectedId !== lastRequestedId.current) {
      autoRetrySpent.current = false
      lastRequestedId.current = null
    }
  }, [selectedId])

  // Error settle: permite UN reintento automático por selección (fix CRITICAL
  // R3-001). Un loadRobot(X) fallido nunca cambia confirmedId, así que el reset
  // por identidad confirmada jamás desbloquea X (selectedId === lastRequestedId === X).
  // Un request fallido no debe envenenar la re-selección — pero tampoco debe
  // bombardear el backend: el budget se consume aquí y, tras el segundo fallo,
  // el latch permanece, cortando el bucle hasta que el usuario cambie de selección.
  useEffect(() => {
    if (loadRobot.isError && !autoRetrySpent.current) {
      autoRetrySpent.current = true
      lastRequestedId.current = null
    }
  }, [loadRobot.isError])

  useEffect(() => {
    // Dedupe (decisión pura `shouldRequestRobot`): se saltean los robots ya
    // confirmados por el scene (respuesta de applyScene) o ya solicitados — un
    // import URDF que cambia la identidad de la escena no debe disparar un
    // reload espurio de la última selección del catálogo.
    if (shouldRequestRobot(selectedId, confirmedId, lastRequestedId.current, autoRetrySpent.current) && selectedId) {
      lastRequestedId.current = selectedId
      loadRobot.mutate(selectedId)
    }
  }, [selectedId, confirmedId, loadRobot])

  // Re-arm del latch de GET /scene (fix review): si el boot falló durablemente
  // (retry: 1 agotado) sin identidad confirmada ni request en vuelo, el latch
  // inicial se re-dispara para que un backend recuperado pueda re-inicializar
  // la escena. Acotado por `sceneLoadRearms` para no crear un bucle de re-fires
  // mientras el backend siga caído; la escena inicializada repone el budget.
  useEffect(() => {
    if (confirmedId) {
      sceneLoadRearms.current = 0
      return
    }
    if (!loadScene.isError) return
    if (loadScene.isPending || loadRobot.isPending) return
    if (sceneLoadRearms.current >= MAX_SCENE_LOAD_REARMS) return
    sceneLoadRearms.current += 1
    initialSceneRequested.current = false
  }, [loadScene.isError, loadScene.isPending, loadRobot.isPending, confirmedId])

  // Spec R7/R6 — default derivado del backend. GET /scene es la ÚNICA vía de
  // carga: se dispara siempre que no haya identidad confirmada ni un request
  // de identidad en vuelo. El RobotSelector (y su hint persistido
  // ROBOT_SELECTION_KEY) fue eliminado — el catálogo es la única fuente de
  // selección (spec frontend-task-workspace). Sin este load, arrancar en '/'
  // dejaba la escena sin cargar (viewport vacío y redirect a '/'), y un fallo
  // de GET /robots también bloqueaba la escena. El load extra de GET /scene es
  // seguro: use-scene-loader descarta respuestas stale vía tokens de orden.
  useEffect(() => {
    if (confirmedId) return
    if (loadScene.isPending || loadRobot.isPending) return
    if (initialSceneRequested.current) return
    initialSceneRequested.current = true
    loadScene.mutate()
  }, [confirmedId, loadScene.isPending, loadRobot.isPending, loadScene])
}
