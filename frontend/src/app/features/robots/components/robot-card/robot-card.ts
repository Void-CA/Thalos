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
  styles: [
    `
    .card {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid #333;
      border-radius: 6px;
      background: #252525;
      color: #c0c0c0;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      font-size: 0.85rem;
      transition: background 0.15s, border-color 0.15s;
    }
    .card:hover {
      background: #2a2a2a;
      border-color: #555;
    }
    .card.selected {
      background: #1a2f3f;
      border-color: #3399ff;
    }

    .name {
      font-weight: 600;
      font-size: 0.95rem;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      background: #333;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.03em;
    }
    .card.selected .badge {
      background: #1a4970;
    }

    .joint-summary {
      font-size: 0.75rem;
      opacity: 0.5;
    }
  `,
  ],
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
