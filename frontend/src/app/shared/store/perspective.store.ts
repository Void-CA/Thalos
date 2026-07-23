import { Injectable, signal, computed } from '@angular/core';
import type { Perspective, PerspectiveConfig } from '../types/perspective';
import { PERSPECTIVE_REGISTRY } from '../types/perspective-registry';

const STORAGE_KEY = 'thalos-perspective';

/**
 * Store de la perspectiva activa.
 *
 * Controla la disposición de paneles, tools y contenido según la
 * actividad del usuario.
 *
 * Persiste a localStorage entre sesiones.
 */
@Injectable({ providedIn: 'root' })
export class PerspectiveStore {
  private readonly stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY) as Perspective | null
    : null;

  readonly perspective = signal<Perspective>(
    (this.stored && this.isValid(this.stored)) ? this.stored : 'robot',
  );

  /** Config completa de la perspectiva activa. */
  readonly config = computed<PerspectiveConfig>(
    () => PERSPECTIVE_REGISTRY[this.perspective()],
  );

  /** Atajos para el template. */
  readonly showLeftPanel = computed(() => this.config().showLeftPanel);
  readonly showBottomPanel = computed(() => this.config().showBottomPanel);
  readonly leftPanelContent = computed(() => this.config().leftPanelContent);
  readonly rightPanel = computed(() => this.config().rightPanel);
  readonly bottomTabs = computed(() => this.config().bottomTabs);

  setPerspective(p: Perspective): void {
    this.perspective.set(p);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, p);
    }
  }

  /** Cycle para la top bar o atajo de teclado. */
  cycle(): void {
    const order: Perspective[] = ['robot', 'planning', 'execution', 'knowledge', 'sessions'];
    const idx = order.indexOf(this.perspective());
    this.setPerspective(order[(idx + 1) % order.length]);
  }

  private isValid(p: string): p is Perspective {
    return ['robot', 'planning', 'analysis', 'execution', 'sessions', 'knowledge'].includes(p);
  }
}
