import type { ExecuteSemanticResponse, TaskDocument } from '@/shared/contracts'
import { sceneApi } from '@/features/viewport/api/scene-api'
import { useSceneStore } from '@/features/viewport/store'
import {
  toSceneData, toRuntimeInfo, toIkResult, toActivePlan, toToolFrame, toExecutionInfo,
} from '@/features/viewport/adapter'
import { planAnalysisApi } from '@/features/analysis/api/plan-analysis-api'
import { useAnalysisStore } from '@/features/analysis/store'
import { executeSemantic } from './api'

/**
 * Shared run flow (demos-workspace spec "Run executes via existing pipeline"):
 * the Task editor [Run] and the Demos workspace [Run] trigger the SAME path —
 * POST /semantic/execute → GET /scene read-back → POST /plan/analyze. This
 * module is the single implementation; no new execution path exists (D13).
 */

/**
 * Hotfix (unify-programming): preview a compiled Task program like the Motion
 * tab does — load it into the scene runtime WITHOUT starting it, so the
 * always-mounted viewport draws the trajectory and the Analysis tab populates.
 *
 * The vehicle is `executeSemantic` (`POST /semantic/execute`): the canonical
 * compile + plan path that SCHEDULES the plan into the scene runtime
 * (`schedule_program`), which is what `/plan/analyze` reads the active plan
 * from. `POST /motion/plan` was NOT used: it returns only `compiled_plan` +
 * `runtime_program`, never schedules, so neither `applyScene` (no scene state)
 * nor the analysis endpoint (no active plan) could work. After the plan is
 * scheduled, `getScene()` returns the full state with `active_plan`, and the
 * standard planning-panel adapters project it onto the scene store.
 *
 * Rejections are NON-BLOCKING: callers treat a failure as "compile ok, preview
 * failed" — the plan never starts (the tick loop only runs from Execution).
 */
export async function previewTaskPlan(
  task: TaskDocument,
  executed?: ExecuteSemanticResponse,
): Promise<void> {
  const execute = executed ?? (await executeSemantic({ task }))
  if (execute.status !== 'ok') throw new Error('Plan preview failed')
  const scene = await sceneApi.getScene()
  useSceneStore.getState().applyScene(
    toSceneData(scene.scene),
    toRuntimeInfo(scene),
    toIkResult(scene.ik_result),
    toActivePlan(scene.active_plan),
    toToolFrame(scene.active_tcp),
    toExecutionInfo(scene.execution),
  )
  const analysis = await planAnalysisApi.analyze()
  useAnalysisStore.getState().setAnalysis(analysis)
}
