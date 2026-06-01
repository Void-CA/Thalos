import { Injectable, inject, signal, computed } from '@angular/core';
import { RobotApiService } from '../services/robot-api.service';
import type { RobotMetadataDto } from '../robot-api.types';

@Injectable({ providedIn: 'root' })
export class RobotStore {
  private readonly api = inject(RobotApiService);

  // ── Estado como señales ──

  readonly robots = signal<RobotMetadataDto[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // ── Derivaciones ──

  readonly selectedRobot = computed(() =>
    this.robots().find(r => r.id === this.selectedId()) ?? null,
  );

  // ── Acciones ──

  /** Dispara la carga de robots desde la API. */
  loadRobots(): void {
    this.loading.set(true);
    this.error.set(null);
    this.robots.set([]);
    this.selectedId.set(null);

    this.api.getRobots().subscribe({
      next: robots => {
        this.robots.set(robots);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Failed to load robots');
      },
    });
  }

  /**
   * Marca el robot activo en el catálogo.
   * NO orquesta la escena — eso es responsabilidad del componente.
   */
  select(id: string | null): void {
    if (id === null || this.robots().some(r => r.id === id)) {
      this.selectedId.set(id);
    }
  }
}
