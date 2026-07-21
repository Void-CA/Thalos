import { Component } from '@angular/core';

/**
 * Model Workspace — placeholder.
 *
 * El workspace Model (perspectiva 'robot') usa el layout legacy
 * con left panel (robot catalog) + viewport + right panel (tools).
 * El shell ya maneja esto mediante .layout--robot y los paneles
 * left/right del layout legacy.
 *
 * Este componente es un marcador de posición para cuando se
 * quiera dar al Model workspace un layout propio.
 */
@Component({
  selector: 'model-workspace',
  standalone: true,
  template: '',
})
export class ModelWorkspace {}
