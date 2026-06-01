import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RobotCard } from '../robot-card/robot-card';
import { RobotStore } from '../../store/robot.store';
import { SceneStore } from '../../../scene/store/scene.store';
import type { RobotCatalogState } from '../../robot.types';

/**
 * Panel de catálogo de robots.
 *
 * Responsabilidades (orquestador):
 *  1. Cargar la lista via RobotStore
 *  2. Renderizar cards
 *  3. Click → RobotStore.select(id) + SceneStore.loadRobot(id)
 *
 * NO acopla RobotStore con SceneStore.
 */
@Component({
  selector: 'robot-catalog',
  standalone: true,
  imports: [RobotCard],
  template: `
    <div class="catalog">
      <h3 class="title">Robots</h3>

      @if (state.loading) {
        <p class="status">Loading…</p>
      } @else if (state.error) {
        <p class="status error">{{ state.error }}</p>
      } @else {
        <div class="list">
          @for (robot of state.robots; track robot.id) {
            <robot-card
              [robot]="robot"
              [selected]="robot.id === state.selectedId"
              (select)="onSelect($event)"
            />
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
    .catalog {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .title {
      margin: 0;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .status {
      margin: 0;
      font-size: 0.8rem;
      opacity: 0.5;
    }
    .status.error {
      color: #ff6644;
      opacity: 1;
    }
  `,
  ],
})
export class RobotCatalog implements OnInit {
  private readonly robotStore = inject(RobotStore);
  private readonly sceneStore = inject(SceneStore);
  private readonly destroy = inject(DestroyRef);

  protected state: RobotCatalogState = {
    robots: [],
    selectedId: null,
    loading: true,
    error: null,
  };

  ngOnInit(): void {
    this.robotStore.state$
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(s => (this.state = s));

    this.robotStore.loadRobots();
  }

  protected onSelect(id: string): void {
    this.robotStore.select(id);
    this.sceneStore.loadRobot(id);
  }
}
