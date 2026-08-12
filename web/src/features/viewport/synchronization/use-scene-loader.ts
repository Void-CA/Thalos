import { useMutation } from '@tanstack/react-query'
import { useSceneStore } from '../store'
import { useSceneService } from '../services/service-context'
import { ApiError } from '@/shared/errors'

/**
 * Request ordering tokens (fix review): shared between loadRobot,
 * loadRobotFromUrdf and loadScene to discard stale responses. Each identity
 * request increments `identitySeq`; onSuccess AND onError apply only if their
 * token is still the last one emitted. Without this, a slow loadRobot(A)
 * response resolving after a URDF import (or a GET /scene default resolving
 * after a loadRobot) would revert the confirmed identity — or a stale
 * failure would overwrite a healthy scene's error state.
 *
 * Singleton contract `sceneLoadSeqAtFire`: snapshot of `identitySeq` at the
 * moment a GET /scene is fired (does NOT increment the counter). A GET /scene
 * only applies — on both success and error — if no identity request passed it
 * since it fired. `resetSceneRequestOrdering()` resets both tokens — ONLY for
 * tests (avoids state leakage between cases).
 */
const requestOrdering = {
  identitySeq: 0,
  sceneLoadSeqAtFire: 0,
}

/** Reset the ordering tokens — for tests (avoids state leakage between cases). */
export function resetSceneRequestOrdering() {
  requestOrdering.identitySeq = 0
  requestOrdering.sceneLoadSeqAtFire = 0
}

/**
 * Hook to load a robot into the scene.
 *
 * Dependency: SceneService (injected via ServicesProvider).
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
      return ++requestOrdering.identitySeq // token for this request
    },
    onSuccess: (snapshot, _id, token) => {
      // Stale guard: a newer identity request (e.g. URDF import) passed it —
      // do not apply, do not revert the confirmed identity.
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
    onError: (err: Error, _id: string, token) => {
      // Stale guard (onError): a failure from a superseded request (e.g.
      // loadRobot(A) failing after loadRobot(B) or a URDF import applied)
      // must not overwrite the scene's error state.
      if (token !== requestOrdering.identitySeq) return
      setError(err.message, err instanceof ApiError ? err.code : null)
    },
  })
}

/**
 * Hook to load the current scene state (GET /scene).
 *
 * Provides the initial identity DERIVED FROM THE BACKEND (spec R7): with no
 * prior selection, the default is the robot the backend has in the scene.
 */
export function useLoadScene() {
  const service = useSceneService()
  const applyScene = useSceneStore(s => s.applyScene)
  const setLoading = useSceneStore(s => s.setLoading)
  const setError = useSceneStore(s => s.setError)

  return useMutation({
    // A transient GET /scene failure must not leave the viewport
    // uninitialized without a retry (fix review — App.tsx only retry:1 queries).
    retry: 1,
    mutationFn: () => service.loadScene(),
    onMutate: () => {
      setLoading(true)
      requestOrdering.sceneLoadSeqAtFire = requestOrdering.identitySeq
    },
    onSuccess: (snapshot) => {
      // Stale guard: the backend default response must NOT overwrite an
      // identity already requested/confirmed — neither an identity request
      // emitted after this GET /scene, nor an identity already present in the runtime.
      if (requestOrdering.sceneLoadSeqAtFire !== requestOrdering.identitySeq) return
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
    onError: (err: Error) => {
      // Stale guard (onError): a GET /scene superseded by a newer identity
      // request must not paint a stale error over a healthy scene.
      if (requestOrdering.sceneLoadSeqAtFire !== requestOrdering.identitySeq) return
      setError(err.message, err instanceof ApiError ? err.code : null)
    },
  })
}

/**
 * Hook to import a robot from URDF.
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
      return ++requestOrdering.identitySeq // token for this request
    },
    onSuccess: (snapshot, _source, token) => {
      // Stale guard: a newer import passed it — do not apply.
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
    onError: (err: Error, _source: string, token) => {
      // Stale guard (onError): a superseded import failure must not
      // overwrite the error state with an obsolete identity's.
      if (token !== requestOrdering.identitySeq) return
      setError(err.message, err instanceof ApiError ? err.code : null)
    },
  })
}
