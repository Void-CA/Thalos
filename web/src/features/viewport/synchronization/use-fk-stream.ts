import { useMutation } from '@tanstack/react-query'
import { useSceneStore } from '../store'
import { useSceneService } from '../services/service-context'

/**
 * Hook para enviar cambios de ángulos articulares (FK) al backend.
 *
 * Dependencia: SceneService (inyectado via ServicesProvider).
 */
export function useFkStream() {
  const service = useSceneService()
  const applyFkUpdate = useSceneStore(s => s.applyFkUpdate)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    mutationFn: (joints: number[]) => service.setJoints(joints),
    onMutate: () => setLoading(true),
    onSuccess: (snapshot) => {
      applyFkUpdate(
        snapshot.scene,
        snapshot.runtime,
        snapshot.ikResult,
        snapshot.activeTcp,
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}
