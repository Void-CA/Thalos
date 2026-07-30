import { apiClient } from '@/shared/api-client'
import type {
  RuntimeStateResponse,
  SolveIKResponse,
  PoseTargetDto,
  RuntimeDelta,
} from './scene-api.types'

export const sceneApi = {
  /** Load a robot into the scene. */
  loadRobot: (id: string) =>
    apiClient.post<RuntimeStateResponse>('/scene/robot', { robot_id: id }).then(r => r.data),

  /** Import robot from URDF source string. */
  loadRobotFromUrdf: (source: string) =>
    apiClient.post<RuntimeStateResponse>('/scene/robot/from-urdf', { urdf_source: source }).then(r => r.data),

  /** Set joint angles (FK). Campo: `joint_angles` según SetJointsRequest. */
  setJoints: (joints: number[]) =>
    apiClient.post<RuntimeStateResponse>('/scene/joints', { joint_angles: joints }).then(r => r.data),

  /** Move to position (IK). Omitir frame_id si es undefined para evitar null en la request. */
  moveToPosition: (target: [number, number, number], frame_id?: number) =>
    apiClient.post<RuntimeStateResponse>('/scene/move-to-position', {
      target,
      ...(frame_id !== undefined ? { frame_id } : {}),
    }).then(r => r.data),

  /** Move to pose (IK). */
  moveToPose: (target: PoseTargetDto, frame_id?: number) =>
    apiClient.post<RuntimeStateResponse>('/scene/move-to-pose', {
      target,
      ...(frame_id !== undefined ? { frame_id } : {}),
    }).then(r => r.data),

  /** Solve IK (position, no mutation). */
  solveIkPosition: (target: [number, number, number], frame_id?: number) =>
    apiClient.post<SolveIKResponse>('/scene/solve-ik-position', {
      target,
      ...(frame_id !== undefined ? { frame_id } : {}),
    }).then(r => r.data),

  /** Solve IK (pose, no mutation). */
  solveIkPose: (target: PoseTargetDto, frame_id?: number) =>
    apiClient.post<SolveIKResponse>('/scene/solve-ik-pose', {
      target,
      ...(frame_id !== undefined ? { frame_id } : {}),
    }).then(r => r.data),

  /** Execute solved IK. Campo: `joint_angles` según ExecuteIKRequest. */
  executeIk: (joints: number[]) =>
    apiClient.post<RuntimeStateResponse>('/scene/execute-ik', { joint_angles: joints }).then(r => r.data),

  /** Preview a motion program (compile + visualize, no execution). */
  previewPlan: (request: { segments: any[] }) =>
    apiClient.post<RuntimeStateResponse>('/scene/motion/plan', request).then(r => r.data),

  /** Execution control. */
  startExecution: () =>
    apiClient.post<RuntimeStateResponse>('/scene/motion/start').then(r => r.data),

  pauseExecution: () =>
    apiClient.post<RuntimeStateResponse>('/scene/motion/pause').then(r => r.data),

  resumeExecution: () =>
    apiClient.post<RuntimeStateResponse>('/scene/motion/resume').then(r => r.data),

  cancelExecution: () =>
    apiClient.post<RuntimeStateResponse>('/scene/motion/cancel').then(r => r.data),

  resetExecution: () =>
    apiClient.post<RuntimeStateResponse>('/scene/motion/reset').then(r => r.data),

  /** Tick execution by dt seconds — returns RuntimeDelta with joints + transforms. */
  tickExecution: (dt: number) =>
    apiClient.post<RuntimeDelta>('/scene/motion/tick', { dt }).then(r => r.data),
}
