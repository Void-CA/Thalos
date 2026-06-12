import { Injectable, signal } from '@angular/core';
import type { AppMode } from '../types/app-mode';

/**
 * Store del modo global de la aplicación.
 *
 * Controla qué herramientas se muestran en el panel derecho (Tool Context)
 * y el estado visual de la Top Bar.
 *
 * No contiene lógica de negocio — solo estado de UI.
 */
@Injectable({ providedIn: 'root' })
export class ModeStore {
  readonly mode = signal<AppMode>('analysis');

  setMode(mode: AppMode): void {
    this.mode.set(mode);
  }

  toggle(): void {
    const cycle: AppMode[] = ['analysis', 'planning', 'execution'];
    const idx = cycle.indexOf(this.mode());
    this.mode.set(cycle[(idx + 1) % cycle.length]);
  }
}
