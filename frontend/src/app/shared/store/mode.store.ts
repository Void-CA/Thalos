import { Injectable, signal } from '@angular/core';
import type { AppMode } from '../types/app-mode';

const STORAGE_KEY = 'thalos-mode';

/**
 * Store del modo global de la aplicación.
 *
 * Controla qué herramientas se muestran en el panel derecho (Tool Context)
 * y el estado visual de la Top Bar.
 *
 * Persiste a localStorage para mantener el modo entre sesiones.
 * No contiene lógica de negocio — solo estado de UI.
 */
@Injectable({ providedIn: 'root' })
export class ModeStore {
  private readonly stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY) as AppMode | null
    : null;

  /** Map legacy 'analysis' values from localStorage to 'robot'. */
  private static migrate(stored: string | null): AppMode | null {
    if (stored === 'analysis') return 'robot';
    return stored as AppMode | null;
  }

  readonly mode = signal<AppMode>(ModeStore.migrate(this.stored) ?? 'robot');

  setMode(mode: AppMode): void {
    this.mode.set(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  }

  toggle(): void {
    const cycle: AppMode[] = ['robot', 'planning', 'execution'];
    const idx = cycle.indexOf(this.mode());
    const next = cycle[(idx + 1) % cycle.length];
    this.setMode(next);
  }
}
