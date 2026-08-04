import { useMutation } from '@tanstack/react-query'
import { useSceneStore } from '../store'
import { useSceneService } from '../services/service-context'

/**
 * Tokens de orden de requests (fix review): compartidos entre loadRobot,
 * loadRobotFromUrdf y loadScene para descartar respuestas stale. Cada request
 * de identidad incrementa `identitySeq`; onSuccess aplica solo si su token
 * sigue siendo el último emitido. Sin esto, una respuesta lenta de loadRobot(A)
 * que resuelve después de un import URDF (o un GET /scene default que resuelve
 * después de un loadRobot) revertía la identidad confirmada.
 */
const requestOrdering = {
  identitySeq: 0,
  sceneIdentitySeqAtFire: 0,
}

/** Reset de los tokens de orden — para tests (evita fuga de estado entre casos). */
export function resetSceneRequestOrdering() {
  requestOrdering.identitySeq = 0
  requestOrdering.sceneIdentitySeqAtFire = 0
}

/**
 * Hook para cargar un robot en la escena.
 *
 * Dependencia: SceneService (inyectado via ServicesProvider).
 */
export function useLoadRobot() {
  const service = useSceneService()
  const applyScene = useSceneStore(s => s.applyScene)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    mutationFn: (id: string) => service.loadRobot(id),
    onMutate: () => {
      setLoading(true)
      return ++requestOrdering.identitySeq // token de esta request
    },
    onSuccess: (snapshot, _id, token) => {
      // Stale guard: un request de identidad más nuevo (p.ej. import URDF) la
      // superó — no se aplica, no revierte la identidad confirmada.
      if (token !== requestOrdering.identitySeq) return
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}

/**
 * Hook para cargar el estado de escena actual (GET /scene).
 *
 * Provee la identidad inicial DERIVADA DEL BACKEND (spec R7): sin selección
 * previa, el default es el robot que el backend tiene en la escena (Planar2R).
 */
export function useLoadScene() {
  const service = useSceneService()
  const applyScene = useSceneStore(s => s.applyScene)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    // Un fallo transitorio de GET /scene no debe dejar el viewport
    // desinicializado sin reintento (fix review — App.tsx solo retry:1 queries).
    retry: 1,
    mutationFn: () => service.loadScene(),
    onMutate: () => {
      setLoading(true)
      requestOrdering.sceneIdentitySeqAtFire = requestOrdering.identitySeq
    },
    onSuccess: (snapshot) => {
      // Stale guard: la respuesta del backend default NO debe pisar una
      // identidad ya solicitada/confirmada — ni un request de identidad emitido
      // después de este GET /scene, ni una identidad ya presente en el runtime.
      if (requestOrdering.sceneIdentitySeqAtFire !== requestOrdering.identitySeq) return
      if (useSceneStore.getState().runtime !== null) return
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}

/**
 * Hook para importar un robot desde URDF.
 */
export function useLoadRobotFromUrdf() {
  const service = useSceneService()
  const applyScene = useSceneStore(s => s.applyScene)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    mutationFn: (source: string) => service.loadRobotFromUrdf(source),
    onMutate: () => {
      setLoading(true)
      return ++requestOrdering.identitySeq // token de esta request
    },
    onSuccess: (snapshot, _source, token) => {
      // Stale guard: un import más nuevo la superó — no se aplica.
      if (token !== requestOrdering.identitySeq) return
      applyScene(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activePlan,
        snapshot.activeTcp,
        snapshot.execution,
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}
