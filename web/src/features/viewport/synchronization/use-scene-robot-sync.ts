import { useEffect, useRef } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useLoadRobot } from './use-scene-loader'

/**
 * Sincroniza la selección de robot del catálogo con la escena 3D.
 *
 * Cuando el usuario selecciona un robot en el catálogo, automáticamente
 * lo carga en el viewport vía la API.
 */
export function useSceneRobotSync() {
  const selectedId = useRobotStore(s => s.selectedId)
  const loadRobot = useLoadRobot()
  const lastLoaded = useRef<string | null>(null)

  useEffect(() => {
    if (selectedId && selectedId !== lastLoaded.current) {
      lastLoaded.current = selectedId
      loadRobot.mutate(selectedId)
    }
  }, [selectedId, loadRobot])
}
