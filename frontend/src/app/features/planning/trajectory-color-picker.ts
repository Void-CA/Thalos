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
  styleUrl: './trajectory-color-picker.scss',
})
export class TrajectoryColorPicker {
  protected readonly renderer = inject(ThreeRendererService);
  protected readonly modes = MODES;
}
