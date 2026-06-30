import { Component, inject, OnInit, signal } from '@angular/core';
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
 *  4. Importar robots desde archivos URDF
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

      <hr class="divider" />

      <h3 class="title">Import URDF</h3>
      <input
        #fileInput
        type="file"
        accept=".urdf,.xml"
        hidden
        (change)="onFileSelected(fileInput.files)"
      />
      <button class="urdf-btn" (click)="fileInput.click()">
        Choose file…
      </button>

      @if (urdfFileName(); as name) {
        <p class="file-name">{{ name }}</p>
      }
    </div>
  `,
  styleUrl: './robot-catalog.scss',
})
export class RobotCatalog implements OnInit {
  private readonly robotStore = inject(RobotStore);
  private readonly sceneStore = inject(SceneStore);

  // Señales del store expuestas al template
  protected readonly robots = this.robotStore.robots;
  protected readonly selectedId = this.robotStore.selectedId;
  protected readonly loading = this.robotStore.loading;
  protected readonly error = this.robotStore.error;

  protected readonly urdfFileName = signal<string | null>(null);

  ngOnInit(): void {
    this.robotStore.loadRobots();
  }

  protected onSelect(id: string): void {
    this.robotStore.select(id);
    this.sceneStore.loadRobot(id);
  }

  protected onFileSelected(files: FileList | null): void {
    const file = files?.item(0);
    if (!file) return;

    this.urdfFileName.set(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const source = reader.result as string;
      // Al importar URDF el catálogo canónico ya no tiene un robot
      // "seleccionado" — limpiar para evitar el falso positivo visual.
      this.robotStore.select(null);
      this.sceneStore.loadRobotFromUrdf(source);
    };
    reader.readAsText(file);
  }
}
