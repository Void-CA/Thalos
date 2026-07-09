import { Component, computed, input, output, signal } from '@angular/core';
import type { RobotMetadataDto } from '../../robot-api.types';
import { RobotDownloadPopup } from '../robot-download-popup/robot-download-popup';

/**
 * Card atómica para un robot en el catálogo.
 * Dumb component — solo recibe datos y emite eventos.
 *
 * Wrapped en un <div> para anclar el popup de descarga
 * sin anidar botones HTML inválidos.
 */
@Component({
  selector: 'robot-card',
  standalone: true,
  imports: [RobotDownloadPopup],
  template: `
    <div class="card-wrapper">
      <button
        class="card"
        [class.selected]="selected()"
        (click)="select.emit(robot().id)"
      >
        <span class="name">{{ robot().display_name }}</span>

        <span class="meta">
          <span class="badge">{{ robot().dof }} DOF</span>
          <span class="joint-summary">{{ jointSummary() }}</span>
        </span>
      </button>

      <button
        class="download-btn"
        (click)="togglePopup($event)"
        title="Descargar URDF"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      @if (showPopup()) {
        <robot-download-popup
          [robot]="robot()"
          (close)="showPopup.set(false)"
        />
      }
    </div>
  `,
  styleUrl: './robot-card.scss',
})
export class RobotCard {
  readonly robot = input.required<RobotMetadataDto>();
  readonly selected = input(false);

  readonly select = output<string>();

  protected readonly showPopup = signal(false);

  protected readonly jointSummary = computed(() =>
    this.robot()
      .joints.map(j => (j.kind === 'Revolute' ? 'R' : 'P'))
      .join(' '),
  );

  protected togglePopup(event: MouseEvent): void {
    event.stopPropagation();
    this.showPopup.update(v => !v);
  }
}
