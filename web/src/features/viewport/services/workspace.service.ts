import { apiClient } from '@/shared/api-client'

export interface WorkspaceResult {
  metrics: Record<string, number>
  bounds: { min: [number, number, number]; max: [number, number, number] } | null
}

export interface SingularityResult {
  metrics: Record<string, number>
}

export interface ManipulabilityResult {
  metrics: Record<string, number>
}

export interface SampleParams {
  samples: number
  seed: number
  tolerance: number
}

/**
 * WorkspaceService — análisis de workspace sampling, singularidad, manipulabilidad.
 *
 * Encapsula: rutas de API + transformación.
 * Testeable: inyectando un mock de apiClient.
 */
export class WorkspaceService {
  readonly client: typeof apiClient

  constructor(client: typeof apiClient) {
    this.client = client
  }

  async sample(robotId: string | null, params: SampleParams): Promise<WorkspaceResult> {
    const body = { ...params, include_samples: false }
    if (robotId) {
      const { data } = await this.client.post('/workspace/sample', { robot_id: robotId, ...body })
      return { metrics: data.metrics, bounds: data.bounds ?? null }
    }
    const { data } = await this.client.post('/workspace/sample/active', body)
    return { metrics: data.metrics, bounds: data.bounds ?? null }
  }

  async analyzeSingularity(robotId: string | null, params: SampleParams): Promise<SingularityResult> {
    const body = {
      ...params,
      near_singular_condition_threshold: 100.0,
      include_samples: false,
    }
    if (robotId) {
      const { data } = await this.client.post('/workspace/singularity', { robot_id: robotId, ...body })
      return { metrics: data.metrics }
    }
    const { data } = await this.client.post('/workspace/singularity/active', body)
    return { metrics: data.metrics }
  }

  async analyzeManipulability(robotId: string | null, params: SampleParams): Promise<ManipulabilityResult> {
    const body = { ...params, include_samples: false }
    if (robotId) {
      const { data } = await this.client.post('/workspace/manipulability', { robot_id: robotId, ...body })
      return { metrics: data.metrics }
    }
    const { data } = await this.client.post('/workspace/manipulability/active', body)
    return { metrics: data.metrics }
  }
}

export const workspaceService = new WorkspaceService(apiClient)
