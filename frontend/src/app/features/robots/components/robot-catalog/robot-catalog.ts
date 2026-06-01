import { Component, inject, OnInit } from '@angular/core';
import { RobotCard } from '../robot-card/robot-card';
import { RobotStore } from '../../store/robot.store';
import { SceneStore } from '../../../scene/store/scene.store';

/**
 * Panel de catálogo de robots.
 *
 * Responsabilidades (orquestador):
 *  1. Cargar la lista via RobotStore
 *  2. Renderizar cards
 *  3. Click → RobotStore.select(id) + SceneStore.loadRobot(id)
 *
 * NO acopla RobotStore con SceneStore.
 * Sin subscribe ni zone.js — puros signals.
 */
@Component({
  selector: 'robot-catalog',
  standalone: true,
  imports: [RobotCard],
  template: `
    <div class="catalog">
      <h3 class="title">Robots</h3>

      @if (loading()) {
        <p class="status">Loading…</p>
      } @else if (error(); as err) {
        <p class="status error">{{ err }}</p>
      } @else {
        <div class="list">
          @for (robot of robots(); track robot.id) {
            <robot-card
              [robot]="robot"
              [selected]="robot.id === selectedId()"
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

  // Señales del store expuestas al template
  protected readonly robots = this.robotStore.robots;
  protected readonly selectedId = this.robotStore.selectedId;
  protected readonly loading = this.robotStore.loading;
  protected readonly error = this.robotStore.error;

  ngOnInit(): void {
    this.robotStore.loadRobots();
  }

  protected onSelect(id: string): void {
    this.robotStore.select(id);
    this.sceneStore.loadRobot(id);
  }
}
