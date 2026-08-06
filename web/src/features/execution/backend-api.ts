import { apiClient } from '@/shared/api-client'

/** Wire DTO of `GET /backends` (execution-backend-management spec, PR2a). */
export interface BackendDto {
  id: string
  name: string
  status: string
  connected: boolean
  port?: string | null
}

/**
 * Backend management transport (execution-backend-switch-ui spec): pure HTTP
 * for list/activate/connect/disconnect — no state, no React, no stores.
 */
export const backendApi = {
  list: () => apiClient.get<BackendDto[]>('/backends').then((r) => r.data),

  activate: (id: string) =>
    apiClient.post<{ status: string }>(`/backends/${id}/activate`).then((r) => r.data),

  connect: (id: string, port: string) =>
    apiClient
      .post<{ status: string; connected: boolean }>(`/backends/${id}/connect`, { port })
      .then((r) => r.data),

  disconnect: (id: string) =>
    apiClient.post<{ status: string; connected: boolean }>(`/backends/${id}/disconnect`).then((r) => r.data),
}
