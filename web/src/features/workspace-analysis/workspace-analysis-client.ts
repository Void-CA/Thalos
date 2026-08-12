import { apiClient } from '@/shared/api-client'
import type { CloudPoint } from './workspace-analysis-store'

export interface WorkspaceResult {
  metrics: Record<string, number>
  bounds: { min: [number, number, number]; max: [number, number, number] } | null
  /** Sample points for the cloud (null if include_samples=false). */
  samples: CloudPoint[] | null
}

export interface SingularityResult {
  metrics: Record<string, number>
  samples: CloudPoint[] | null
}

export interface ManipulabilityResult {
  metrics: Record<string, number>
  samples: CloudPoint[] | null
}

export interface SampleParams {
  samples: number
  seed: number
  tolerance: number
}

/**
 * Condition threshold for classifying a sample as near-singular: condition
 * number of the Jacobian matrix (ratio between the strongest and weakest
 * singular value, dimensionless). Mirrors the backend default
 * `SingularityConfig::default()` in thalos-core/analysis/singularity/config.rs;
 * the frontend forwards it as-is in /workspace/singularity.
 */
export const NEAR_SINGULAR_CONDITION_THRESHOLD = 100.0

/** Extracts sample points from a response carrying position.*/
function extractPoints(arr: unknown[] | undefined | null, stateKey?: string): CloudPoint[] | null {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return null
  return arr.map((s: any) => ({
    position: [s.position?.x ?? 0, s.position?.y ?? 0, s.position?.z ?? 0] as [number, number, number],
    ...(stateKey ? { state: s[stateKey] ?? 'unknown' } : {}),
    ...(s.yoshikawa !== undefined ? { yoshikawa: s.yoshikawa } : {}),
  }))
}

/**
 * WorkspaceService — workspace sampling, singularity, manipulability analysis.
 */
export class WorkspaceService {
  readonly client: typeof apiClient

  constructor(client: typeof apiClient) {
    this.client = client
  }

  async sample(robotId: string | null, params: SampleParams): Promise<WorkspaceResult> {
    const body = { ...params, include_samples: true }
    if (robotId) {
      const { data } = await this.client.post('/workspace/sample', { robot_id: robotId, ...body })
      return {
        metrics: data.metrics,
        bounds: data.bounds ?? null,
        samples: extractPoints(data.samples),
      }
    }
    const { data } = await this.client.post('/workspace/sample/active', body)
    return {
      metrics: data.metrics,
      bounds: data.bounds ?? null,
      samples: extractPoints(data.samples),
    }
  }

  async analyzeSingularity(robotId: string | null, params: SampleParams): Promise<SingularityResult> {
    const body = {
      ...params,
      near_singular_condition_threshold: NEAR_SINGULAR_CONDITION_THRESHOLD,
      include_samples: true,
    }
    if (robotId) {
      const { data } = await this.client.post('/workspace/singularity', { robot_id: robotId, ...body })
      return { metrics: data.metrics, samples: extractPoints(data.samples, 'state') }
    }
    const { data } = await this.client.post('/workspace/singularity/active', body)
    return { metrics: data.metrics, samples: extractPoints(data.samples, 'state') }
  }

  async analyzeManipulability(robotId: string | null, params: SampleParams): Promise<ManipulabilityResult> {
    const body = { ...params, include_samples: true }
    if (robotId) {
      const { data } = await this.client.post('/workspace/manipulability', { robot_id: robotId, ...body })
      return { metrics: data.metrics, samples: extractPoints(data.samples) }
    }
    const { data } = await this.client.post('/workspace/manipulability/active', body)
    return { metrics: data.metrics, samples: extractPoints(data.samples) }
  }
}

export const workspaceService = new WorkspaceService(apiClient)
