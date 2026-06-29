import { Component, inject, OnInit, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { RobotCard } from '../robot-card/robot-card';
import { RobotStore } from '../../store/robot.store';
import { SceneStore } from '../../../scene/store/scene.store';

/**
 * Panel de catálogo de robots — con accordions colapsables.
 *
 * Dos secciones:
 *   - Canonical Models (open) — lista de robots del catálogo
 *   - Import URDF (closed) — file picker para URDF
 *
 * Usa el mismo patrón <details class="accordion"> que las tools del panel derecho.
 */
@Component({
  selector: 'robot-catalog',
  standalone: true,
  imports: [NgIcon, RobotCard],
  template: `
    <div class="catalog">
      <details class="accordion" open>
        <summary class="accordion__header">
          <ng-icon name="heroRectangleGroup" size="18" />
          <span class="accordion__title">Canonical Models</span>
          <span class="accordion__chevron"></span>
        </summary>
        <div class="accordion__body">
          @if (loading()) {
            <p class="catalog__status">Loading…</p>
          } @else if (error(); as err) {
            <p class="catalog__status catalog__status--error">{{ err }}</p>
          } @else {
            <div class="catalog__list">
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
      </details>

      <details class="accordion">
        <summary class="accordion__header">
          <ng-icon name="heroArrowUpOnSquare" size="18" />
          <span class="accordion__title">Import URDF</span>
          <span class="accordion__chevron"></span>
        </summary>
        <div class="accordion__body">
          <input
            #fileInput
            type="file"
            accept=".urdf,.xml"
            hidden
            (change)="onFileSelected(fileInput.files)"
          />
          <button class="catalog__urdf-btn" (click)="fileInput.click()">
            Choose file…
          </button>
          @if (urdfFileName(); as name) {
            <p class="catalog__file-name">{{ name }}</p>
          }
        </div>
      </details>
    </div>
  `,
  styleUrl: './robot-catalog.scss',
})
export class RobotCatalog implements OnInit {
  private readonly robotStore = inject(RobotStore);
  private readonly sceneStore = inject(SceneStore);

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
      this.robotStore.select(null);
      this.sceneStore.loadRobotFromUrdf(source);
    };
    reader.readAsText(file);
  }
}
