import { useMutation } from '@tanstack/react-query'
import { useSceneStore } from '../store'
import { useSceneService } from '../services/service-context'

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
    onMutate: () => setLoading(true),
    onSuccess: (snapshot) => {
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
    mutationFn: () => service.loadScene(),
    onMutate: () => setLoading(true),
    onSuccess: (snapshot) => {
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
    onMutate: () => setLoading(true),
    onSuccess: (snapshot) => {
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
