import type { RobotMetadataDto } from './robot-api.types';

/**
 * Estado del catálogo de robots.
 *
 * El robot activo se deriva (derive), no se duplica:
 *   selectedRobot = robots.find(r => r.id === selectedId)
 */
export interface RobotCatalogState {
  robots: RobotMetadataDto[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
}
