import { useEffect, useRef } from 'react'
import { useRobotStore } from '@/features/robots/store'
import { useSceneStore } from '../store'
import { useLoadRobot, useLoadScene } from './use-scene-loader'

/**
 * Auto re-arm limit of the GET /scene latch (fix review): if boot fails
 * durably (retry: 1 of the mutation exhausted), `initialSceneRequested`
 * stayed true forever and a recovered backend never re-initialized the
 * scene. The re-arm grants bounded retries so automatic recovery is
 * possible WITHOUT a down backend producing an infinite re-fire loop.
 */
const MAX_SCENE_LOAD_REARMS = 2

/**
 * Pure request-effect decision of the sync hook (spec R2.1): should a
 * loadRobot for `selectedId` fire right now?
 *
 * Catalog selection is a REQUEST; the confirmed identity lives in the scene
 * runtime (`confirmedId`), so an already-confirmed robot is never re-fetched.
 * `lastRequestedId` is the dedupe latch: the in-flight request for the current
 * selection. `autoRetrySpent` is the automatic-retry budget (at most one per
 * selection after an error): the error-settle consumes the budget and clears
 * the latch to grant that retry — so a clean latch with a spent budget is
 * EXACTLY the pending-retry state and the request is allowed; a set latch with
 * a spent budget is the exhausted retry and it is blocked until the user
 * changes the selection (which resets budget and latch together).
 */
export function shouldRequestRobot(
  selectedId: string | null,
  confirmedId: string | null,
  lastRequestedId: string | null,
  autoRetrySpent: boolean,
): boolean {
  if (!selectedId) return false
  if (selectedId === confirmedId) return false
  // Dedupe latch: the request for this selection was already emitted (in-flight
  // or exhausted after an error). Only the error-settle (granted retry) or a
  // selection change clears the latch.
  if (selectedId === lastRequestedId) return false
  // Clean latch → fresh selection or granted retry: both legitimate.
  // `autoRetrySpent` is read to keep the full contract explicit: a spent
  // budget must never coincide with a clean latch except right after the
  // error-settle that granted the retry (the `lastRequestedId === null`
  // defense is what allows that single case).
  return !autoRetrySpent || lastRequestedId === null
}

/**
 * Syncs the catalog robot selection with the 3D scene.
 *
 * The CONFIRMED robot identity lives in the scene runtime, written exclusively
 * by `applyScene` (spec R2.1 — single writer). The catalog selection is only a
 * REQUEST: when the user picks a robot the scene already confirms, no load fires.
 *
 * When the user selects a robot in the catalog, it is automatically loaded in
 * the viewport via the API (if the scene does not confirm it yet).
 */
export function useSceneRobotSync() {
  const selectedId = useRobotStore(s => s.selectedId)
  const loadRobot = useLoadRobot()
  const loadScene = useLoadScene()
  const confirmedId = useSceneStore(s => s.runtime?.robot.id ?? null)
  const lastRequestedId = useRef<string | null>(null)
  const initialSceneRequested = useRef(false)
  // GET /scene re-arms consumed: the re-arm grants at most
  // MAX_SCENE_LOAD_REARMS automatic retries of the initial latch.
  const sceneLoadRearms = useRef(0)
  // Automatic retry budget: allows at most ONE re-request after a failure per
  // selection. Without this flag, resetting lastRequestedId on every isError
  // flip re-fired the request effect (the useMutation object is fresh per
  // render) → infinite POST /scene/robot loop (CRITICAL R3-001).
  const autoRetrySpent = useRef(false)

  // Invalidates the dedupe latch when the confirmed identity changes (fix review):
  // the flow "select scara → import URDF → re-select scara" was silently ignored
  // because selectedId('scara') === lastRequestedId, even when confirmedId was no
  // longer scara. Runs BEFORE the request effect so a distinct re-selection is
  // re-requested in the same commit. The guard does not depend on confirmedId
  // being truthy: it also invalidates when the confirmed identity goes null/falsy
  // (scene reset).
  useEffect(() => {
    if (confirmedId !== lastRequestedId.current) {
      lastRequestedId.current = null
    }
  }, [confirmedId])

  // When the user changes the selection, the retry budget resets and the latch
  // clears: a distinct selection (or a deselection) re-enables the automatic
  // retry of the failed robot.
  useEffect(() => {
    if (selectedId !== lastRequestedId.current) {
      autoRetrySpent.current = false
      lastRequestedId.current = null
    }
  }, [selectedId])

  // Error settle: allows ONE automatic retry per selection (fix CRITICAL
  // R3-001). A failed loadRobot(X) never changes confirmedId, so the confirmed-
  // identity reset never unlocks X (selectedId === lastRequestedId === X).
  // A failed request must not poison the re-selection — but it must not
  // bombard the backend either: the budget is consumed here and, after the
  // second failure, the latch stays, cutting the loop until the user changes
  // the selection.
  useEffect(() => {
    if (loadRobot.isError && !autoRetrySpent.current) {
      autoRetrySpent.current = true
      lastRequestedId.current = null
    }
  }, [loadRobot.isError])

  useEffect(() => {
    // Dedupe (pure decision `shouldRequestRobot`): skips robots already
    // confirmed by the scene (applyScene response) or already requested — a
    // URDF import that changes the scene identity must not fire a spurious
    // reload of the last catalog selection.
    if (shouldRequestRobot(selectedId, confirmedId, lastRequestedId.current, autoRetrySpent.current) && selectedId) {
      lastRequestedId.current = selectedId
      loadRobot.mutate(selectedId)
    }
  }, [selectedId, confirmedId, loadRobot])

  // Re-arm of the GET /scene latch (fix review): if boot failed durably
  // (retry: 1 exhausted) with no confirmed identity and no in-flight request,
  // the initial latch re-fires so a recovered backend can re-initialize the
  // scene. Bounded by `sceneLoadRearms` to avoid a re-fire loop while the
  // backend stays down; the initialized scene replenishes the budget.
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

  // Spec R7/R6 — backend-derived default. GET /scene is the ONLY load path:
  // it fires whenever there is no confirmed identity or in-flight identity
  // request. The RobotSelector (and its persisted ROBOT_SELECTION_KEY hint)
  // was removed — the catalog is the only selection source (spec
  // frontend-task-workspace). Without this load, starting at '/' left the
  // scene unloaded (empty viewport and redirect to '/'), and a GET /robots
  // failure also blocked the scene. The extra GET /scene load is safe:
  // use-scene-loader discards stale responses via ordering tokens.
  useEffect(() => {
    if (confirmedId) return
    if (loadScene.isPending || loadRobot.isPending) return
    if (initialSceneRequested.current) return
    initialSceneRequested.current = true
    loadScene.mutate()
  }, [confirmedId, loadScene.isPending, loadRobot.isPending, loadScene])
}
