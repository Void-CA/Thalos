import { Component, inject } from '@angular/core';
import { ThreeRendererService, type TrajectoryColorMode } from '../scene/services/three-renderer.service';

const MODES: { key: TrajectoryColorMode; label: string }[] = [
  { key: 'segment', label: 'Segment' },
  { key: 'trajectory-quality', label: 'Trajectory Quality' },
  { key: 'manipulability', label: 'Manipulability' },
  { key: 'singularity', label: 'Singularity' },
];

@Component({
  selector: 'trajectory-color-picker',
  standalone: true,
  template: `
    <div class="color-picker">
      @for (m of modes; track m.key) {
        <button
          class="color-picker__btn"
          [class.color-picker__btn--active]="renderer.colorMode() === m.key"
          (click)="renderer.colorMode.set(m.key)"
        >{{ m.label }}</button>
      }
    </div>
  `,
  styles: [
    `
    .color-picker {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .color-picker__btn {
      font-family: inherit;
      font-size: 0.72rem;
      text-align: left;
      padding: 0.25rem 0.4rem;
      border: 1px solid transparent;
      border-radius: 3px;
      background: transparent;
      color: #999;
      cursor: pointer;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .color-picker__btn:hover {
      color: #ddd;
      border-color: #444;
    }
    .color-picker__btn--active {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border-color: #555;
    }
    `,
  ],
})
export class TrajectoryColorPicker {
  protected readonly renderer = inject(ThreeRendererService);
  protected readonly modes = MODES;
}
