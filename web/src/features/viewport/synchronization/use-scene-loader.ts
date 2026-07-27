import { useMutation } from '@tanstack/react-query'
import { sceneApi } from '../api/scene-api'
import { useSceneStore } from '../store'
import { toSceneData, toRuntimeInfo, toIkResult, toActivePlan, toToolFrame, toExecutionInfo } from '../adapter'

/**
 * Hook para cargar un robot en la escena.
 *
 * Uso:
 * ```tsx
 * const loadRobot = useLoadRobot()
 * loadRobot.mutate('ur5')
 * ```
 */
export function useLoadRobot() {
  const applyScene = useSceneStore(s => s.applyScene)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    mutationFn: (id: string) => sceneApi.loadRobot(id),
    onMutate: () => setLoading(true),
    onSuccess: (res) => {
      applyScene(
        toSceneData(res.scene),
        toRuntimeInfo(res),
        toIkResult(res.ik_result),
        toActivePlan(res.active_plan),
        toToolFrame(res.active_tcp),
        toExecutionInfo(res.execution),
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}

/**
 * Hook para importar un robot desde URDF.
 */
export function useLoadRobotFromUrdf() {
  const applyScene = useSceneStore(s => s.applyScene)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    mutationFn: (source: string) => sceneApi.loadRobotFromUrdf(source),
    onMutate: () => setLoading(true),
    onSuccess: (res) => {
      applyScene(
        toSceneData(res.scene),
        toRuntimeInfo(res),
        toIkResult(res.ik_result),
        toActivePlan(res.active_plan),
        toToolFrame(res.active_tcp),
        toExecutionInfo(res.execution),
      )
    },
    onError: (err: Error) => setError(err.message),
  })
}
