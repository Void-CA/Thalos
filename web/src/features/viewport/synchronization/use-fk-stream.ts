import { useMutation } from '@tanstack/react-query'
import { sceneApi } from '../api/scene-api'
import { useSceneStore } from '../store'
import { toSceneData, toRuntimeInfo, toIkResult, toToolFrame } from '../adapter'

/**
 * Hook para enviar cambios de ángulos articulares (FK) al backend
 * y actualizar la escena con la respuesta.
 *
 * Uso:
 * ```tsx
 * const fkMutation = useFkStream()
 * fkMutation.mutate([0.5, 0.1, -0.3, ...])
 * ```
 */
export function useFkStream() {
  const applyFkUpdate = useSceneStore(s => s.applyFkUpdate)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    mutationFn: (joints: number[]) => sceneApi.setJoints(joints),
    onMutate: () => setLoading(true),
    onSuccess: (res) => {
      applyFkUpdate(
        toSceneData(res.scene),
        toRuntimeInfo(res),
        toIkResult(res.ik_result),
        toToolFrame(res.active_tcp),
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}
