import { sceneApi } from '../api/scene-api'
import {
  toSceneData,
  toRuntimeInfo,
  toIkResult,
  toActivePlan,
  toToolFrame,
  toExecutionInfo,
} from '../adapter'
import type { SceneData, RuntimeInfo, IkResult, ActivePlan, ToolFrame, ExecutionInfo } from '../types'
import type { RuntimeStateResponse, PoseTargetDto } from '../api/scene-api.types'

/**
 * SceneSnapshot — estado completo de la escena post-operación,
 * ya transformado de DTOs a tipos de dominio.
 */
export interface SceneSnapshot {
  scene: SceneData
  runtime: RuntimeInfo
  ikResult: IkResult | null
  activePlan: ActivePlan | null
  activeTcp: ToolFrame | null
  execution: ExecutionInfo | null
}

/**
 * FkUpdateSnapshot — versión liviana para FK (no altera plan ni execution).
 */
export interface FkUpdateSnapshot {
  scene: SceneData
  runtime: RuntimeInfo
  ikResult: IkResult | null
  activeTcp: ToolFrame | null
}

/**
 * SolvedIk — resultado del solver IK.
 */
export interface SolvedIk {
  joints: number[]
  status: 'Converged' | 'MaxIterations'
  iterations: number
  finalError: number
}

function toSnapshot(res: RuntimeStateResponse): SceneSnapshot {
  return {
    scene: toSceneData(res.scene),
    runtime: toRuntimeInfo(res),
    ikResult: toIkResult(res.ik_result),
    activePlan: toActivePlan(res.active_plan),
    activeTcp: toToolFrame(res.active_tcp),
    execution: toExecutionInfo(res.execution),
  }
}

function toFkSnapshot(res: RuntimeStateResponse): FkUpdateSnapshot {
  return {
    scene: toSceneData(res.scene),
    runtime: toRuntimeInfo(res),
    ikResult: toIkResult(res.ik_result),
    activeTcp: toToolFrame(res.active_tcp),
  }
}

/**
 * SceneService — capa de negocio para operaciones de escena robótica.
 *
 * Encapsula: API calls + transformación DTO → dominio.
 * Testeable: inyectando un mock del objeto api.
 */
export class SceneService {
  readonly api: typeof sceneApi

  constructor(api: typeof sceneApi) {
    this.api = api
  }

  async loadRobot(id: string): Promise<SceneSnapshot> {
    const res = await this.api.loadRobot(id)
    return toSnapshot(res)
  }

  /** Load the current scene state — backend-derived default identity (spec R7). */
  async loadScene(): Promise<SceneSnapshot> {
    const res = await this.api.getScene()
    return toSnapshot(res)
  }

  async loadRobotFromUrdf(source: string): Promise<SceneSnapshot> {
    const res = await this.api.loadRobotFromUrdf(source)
    return toSnapshot(res)
  }

  async setJoints(joints: number[]): Promise<FkUpdateSnapshot> {
    const res = await this.api.setJoints(joints)
    return toFkSnapshot(res)
  }

  /** Select or clear the active TCP (spec tcp-resolved-pose R2). Returns the
   *  full updated snapshot; `activeTcp.resolvedPose` reflects the backend FK
   *  result when the TCP is active. */
  async selectToolFrame(frameId?: number | null, offset?: [number, number, number] | null): Promise<SceneSnapshot> {
    const res = await this.api.selectToolFrame(frameId, offset)
    return toSnapshot(res)
  }

  async moveToPosition(target: [number, number, number], frameId?: number): Promise<SceneSnapshot> {
    const res = await this.api.moveToPosition(target, frameId)
    return toSnapshot(res)
  }

  async moveToPose(target: PoseTargetDto, frameId?: number): Promise<SceneSnapshot> {
    const res = await this.api.moveToPose(target, frameId)
    return toSnapshot(res)
  }

  async solveIkPosition(target: [number, number, number], frameId?: number): Promise<SolvedIk> {
    const res = await this.api.solveIkPosition(target, frameId)
    return {
      joints: res.joints,
      status: res.ik_result.status,
      iterations: res.ik_result.iterations,
      finalError: res.ik_result.final_error,
    }
  }

  async solveIkPose(target: PoseTargetDto, frameId?: number): Promise<SolvedIk> {
    const res = await this.api.solveIkPose(target, frameId)
    return {
      joints: res.joints,
      status: res.ik_result.status,
      iterations: res.ik_result.iterations,
      finalError: res.ik_result.final_error,
    }
  }

  async executeIk(joints: number[]): Promise<SceneSnapshot> {
    const res = await this.api.executeIk(joints)
    return toSnapshot(res)
  }

  async startExecution(): Promise<SceneSnapshot> {
    const res = await this.api.startExecution()
    return toSnapshot(res)
  }

  async pauseExecution(): Promise<SceneSnapshot> {
    const res = await this.api.pauseExecution()
    return toSnapshot(res)
  }

  async cancelExecution(): Promise<SceneSnapshot> {
    const res = await this.api.cancelExecution()
    return toSnapshot(res)
  }
}

/** Singleton para uso fuera de React (testing). */
export const sceneService = new SceneService(sceneApi)
