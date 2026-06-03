import { Component, computed, input, output } from '@angular/core';
import type { RobotMetadataDto } from '../../robot-api.types';

/**
 * Card atómica para un robot en el catálogo.
 * Dumb component — solo recibe datos y emite eventos.
 */
@Component({
  selector: 'robot-card',
  standalone: true,
  template: `
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
  `,
  styleUrl: './robot-card.scss',
})
export class RobotCard {
  readonly robot = input.required<RobotMetadataDto>();
  readonly selected = input(false);

  readonly select = output<string>();

  protected readonly jointSummary = computed(() =>
    this.robot()
      .joints.map(j => (j.kind === 'Revolute' ? 'R' : 'P'))
      .join(' '),
  );
}
