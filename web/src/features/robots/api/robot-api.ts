import { apiClient } from '@/shared/api-client'
import type { RobotMetadataDto } from './robot-api.types'

export const robotApi = {
  list: () =>
    apiClient.get<RobotMetadataDto[]>('/robots').then(r => r.data),

  get: (id: string) =>
    apiClient.get<RobotMetadataDto>(`/robots/${id}`).then(r => r.data),
}
