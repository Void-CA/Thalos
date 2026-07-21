import { Type } from '@angular/core';

/** Perspectiva de la interfaz — define la disposición de paneles para una tarea. */
export type Perspective = 'robot' | 'planning' | 'execution' | 'sessions';

/** Un tool del panel derecho. */
export interface ToolSchema {
  id: string;
  label: string;
  component: Type<unknown>;
  defaultOpen: boolean;
}

/** Una tab del panel inferior. */
export interface TabSchema {
  id: string;
  label: string;
  icon: string;
}

/** Contenido del panel izquierdo. */
export type LeftPanelContent = 'robots' | 'sessions';

/** Configuración completa de una perspectiva. */
export interface PerspectiveConfig {
  /** Mostrar el panel izquierdo. */
  showLeftPanel: boolean;
  /** Mostrar el panel inferior. */
  showBottomPanel: boolean;
  /** Contenido del panel izquierdo. */
  leftPanelContent?: LeftPanelContent;
  /** Tools del panel derecho. */
  rightPanel: ToolSchema[];
  /** Tabs del panel inferior. */
  bottomTabs: TabSchema[];
}

/**
 * Legacy AppMode — mantiene compatibilidad.
 * @deprecated Usar `Perspective`.
 */
export type AppMode = Perspective;
