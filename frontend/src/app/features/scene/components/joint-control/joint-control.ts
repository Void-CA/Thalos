import { Component, inject } from '@angular/core';
import { SceneStore } from '../../store/scene.store';

/**
 * Slider driver for joint angles.
 *
 * No logic beyond: slider value → store.setJointAngles().
 * The store owns all state, timing, and API orchestration.
 */
@Component({
  selector: 'joint-control',
  standalone: true,
  template: `
    <div class="joint-panel">
      <h3>Joints</h3>
      <label>
        q<sub>1</sub>
        <input
          type="range"
          min="-3.14"
          max="3.14"
          step="0.01"
          [value]="q1"
          (input)="onQ1($event)"
        />
        <span class="value">{{ q1.toFixed(2) }}</span>
      </label>
      <label>
        q<sub>2</sub>
        <input
          type="range"
          min="-3.14"
          max="3.14"
          step="0.01"
          [value]="q2"
          (input)="onQ2($event)"
        />
        <span class="value">{{ q2.toFixed(2) }}</span>
      </label>
    </div>
  `,
  styles: [
    `
    .joint-panel { font-family: monospace; }
    h3 {
      margin: 0 0 0.75rem;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
    }
    input[type="range"] { flex: 1; accent-color: #3399ff; }
    .value { min-width: 3.5ch; text-align: right; opacity: 0.6; }
  `,
  ],
})
export class JointControl {
  private readonly store = inject(SceneStore);

  protected q1 = 0;
  protected q2 = 0;

  protected onQ1(e: Event): void {
    this.q1 = parseFloat((e.target as HTMLInputElement).value);
    this.emit();
  }

  protected onQ2(e: Event): void {
    this.q2 = parseFloat((e.target as HTMLInputElement).value);
    this.emit();
  }

  private emit(): void {
    this.store.setJointAngles([this.q1, this.q2]);
  }
}
