import { Type } from '@angular/core';

/**
 * Declara un tool que se renderiza en el panel derecho según el modo activo.
 *
 * El panel derecho NO hardcodea tools — consume schemas del registry.
 * Agregar un tool nuevo = agregar una entrada al schema, no tocar el layout.
 */
export interface ToolSchema {
  /** Identificador estable del tool. */
  id: string;
  /** Título visible en el accordion header. */
  label: string;
  /** Componente standalone que implementa el tool. */
  component: Type<unknown>;
  /** Si el accordion arranca abierto. */
  defaultOpen: boolean;
}
