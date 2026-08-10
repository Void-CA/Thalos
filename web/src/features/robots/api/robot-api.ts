import { apiClient } from '@/shared/api-client'
import type { RobotMetadataDto } from './robot-api.types'

export const robotApi = {
  list: () =>
    apiClient.get<RobotMetadataDto[]>('/robots').then(r => r.data),
}
