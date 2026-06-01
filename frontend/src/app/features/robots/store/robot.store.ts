import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map } from 'rxjs';
import { RobotApiService } from '../services/robot-api.service';
import type { RobotCatalogState } from '../robot.types';

const INITIAL: RobotCatalogState = {
  robots: [],
  selectedId: null,
  loading: false,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class RobotStore {
  private readonly api = inject(RobotApiService);
  private readonly state = new BehaviorSubject<RobotCatalogState>(INITIAL);

  /** Estado completo del catálogo. */
  readonly state$: Observable<RobotCatalogState> = this.state.asObservable();

  /** Solo el selectedId, para reacciones externas sin acoplar stores. */
  readonly selectedId$: Observable<string | null> = this.state$.pipe(
    map(s => s.selectedId),
    distinctUntilChanged(),
  );

  /** Dispara la carga de robots desde la API. */
  loadRobots(): void {
    this.state.next({ ...this.state.value, loading: true });

    this.api.getRobots().subscribe({
      next: robots =>
        this.state.next({
          robots,
          selectedId: null,
          loading: false,
          error: null,
        }),
      error: (err: Error) =>
        this.state.next({
          robots: [],
          selectedId: null,
          loading: false,
          error: err.message ?? 'Failed to load robots',
        }),
    });
  }

  /**
   * Marca el robot activo en el catálogo.
   * NO orquesta la escena — eso es responsabilidad del componente.
   */
  select(id: string | null): void {
    const current = this.state.value;
    if (id === null || current.robots.some(r => r.id === id)) {
      this.state.next({ ...current, selectedId: id });
    }
  }
}
