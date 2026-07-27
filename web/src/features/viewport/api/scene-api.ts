import { apiClient } from '@/shared/api-client'
import type {
  RuntimeStateResponse,
  SolveIKResponse,
  PoseTargetDto,
} from './scene-api.types'

export const sceneApi = {
  /** Load a robot into the scene. */
  loadRobot: (id: string) =>
    apiClient.post<RuntimeStateResponse>('/scene/robot', { robot_id: id }).then(r => r.data),

  /** Import robot from URDF source string. */
  loadRobotFromUrdf: (source: string) =>
    apiClient.post<RuntimeStateResponse>('/scene/robot/from-urdf', { urdf: source }).then(r => r.data),

  /** Set joint angles (FK). */
  setJoints: (joints: number[]) =>
    apiClient.post<RuntimeStateResponse>('/scene/joints', { joints }).then(r => r.data),

  /** Move to position (IK). */
  moveToPosition: (target: [number, number, number], frame_id?: number) =>
    apiClient.post<RuntimeStateResponse>('/scene/move-to-position', {
      target,
      frame_id: frame_id ?? null,
    }).then(r => r.data),

  /** Move to pose (IK). */
  moveToPose: (target: PoseTargetDto, frame_id?: number) =>
    apiClient.post<RuntimeStateResponse>('/scene/move-to-pose', {
      target,
      frame_id: frame_id ?? null,
    }).then(r => r.data),

  /** Solve IK (position, no mutation). */
  solveIkPosition: (target: [number, number, number], frame_id?: number) =>
    apiClient.post<SolveIKResponse>('/scene/solve-ik-position', {
      target,
      frame_id: frame_id ?? null,
    }).then(r => r.data),

  /** Solve IK (pose, no mutation). */
  solveIkPose: (target: PoseTargetDto, frame_id?: number) =>
    apiClient.post<SolveIKResponse>('/scene/solve-ik-pose', {
      target,
      frame_id: frame_id ?? null,
    }).then(r => r.data),

  /** Execute solved IK. */
  executeIk: (joints: number[]) =>
    apiClient.post<RuntimeStateResponse>('/scene/execute-ik', { joint_angles: joints }).then(r => r.data),

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
}
