import { apiClient } from '@/shared/api-client'
import type { DemoCatalogEntry, SceneFile } from '@/shared/contracts'

/**
 * Demos catalog API client (demos-workspace spec, D10 catalog authority).
 *
 * The backend resolves every demo by id through the catalog — NEVER by
 * filesystem convention — and validates scene files (tiers a+b) before
 * serving. All three methods are GET-only (D12: no POST/PUT/PATCH for scenes
 * or programs; Git remains the source of truth). Rejections flow through the
 * shared api-client error normalization (404 → coded ApiError, network →
 * network_error) untouched.
 */

/** GET /api/v1/demos — catalog metadata only (`[]` when no demos exist). */
export async function listDemos(): Promise<DemoCatalogEntry[]> {
  const { data } = await apiClient.get<DemoCatalogEntry[]>('/demos')
  return data
}

/** GET /api/v1/demos/{id}/scene — SceneFile JSON (backend parse + validate). */
export async function getDemoScene(id: string): Promise<SceneFile> {
  const { data } = await apiClient.get<SceneFile>(`/demos/${id}/scene`)
  return data
}

/** GET /api/v1/demos/{id}/program — the program.thalos text (text/plain). */
export async function getDemoProgram(id: string): Promise<string> {
  const { data } = await apiClient.get<string>(`/demos/${id}/program`)
  return data
}
