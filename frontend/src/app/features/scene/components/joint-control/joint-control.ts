import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SceneStore } from '../../store/scene.store';
import type { JointMetadataDto } from '../../../robots/robot-api.types';

/**
 * Slider driver for joint angles.
 *
 * Se adapta dinámicamente al DOF del robot cargado.
 * Los límites de cada slider vienen del metadata del robot (JointMetadataDto).
 */
@Component({
  selector: 'joint-control',
  standalone: true,
  template: `
    <div class="joint-panel">
      <h3>Joints</h3>

      @for (joint of joints; track $index) {
        <label>
          <span class="joint-label">{{ joint.name }}</span>
          <input
            type="range"
            [min]="joint.min ?? -3.14"
            [max]="joint.max ?? 3.14"
            step="0.01"
            [value]="values[$index]"
            (input)="onSlider($index, $event)"
          />
          <span class="value">{{ values[$index].toFixed(2) }}</span>
        </label>
      } @empty {
        <p class="empty">No robot loaded</p>
      }
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
    .joint-label {
      min-width: 7ch;
      font-size: 0.8rem;
      opacity: 0.8;
    }
    input[type="range"] { flex: 1; accent-color: #3399ff; }
    .value { min-width: 3.5ch; text-align: right; opacity: 0.6; }
    .empty {
      margin: 0;
      font-size: 0.8rem;
      opacity: 0.4;
    }
  `,
  ],
})
export class JointControl {
  private readonly store = inject(SceneStore);
  private readonly destroy = inject(DestroyRef);

  /** Metadata de joints del robot activo (define nombres y límites). */
  protected joints: JointMetadataDto[] = [];
  /** Valores actuales de cada joint. */
  protected values: number[] = [];

  constructor() {
    this.store.state$
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe(state => {
        if (state.runtime) {
          const newJoints = state.runtime.robot.joints;
          // Si cambió el robot (distinto DOF o distinto nombre de joints), reseteamos
          if (newJoints.length !== this.joints.length) {
            this.joints = newJoints;
            this.values = [...state.runtime.joints];
          }
        }
      });
  }

  protected onSlider(index: number, e: Event): void {
    const value = parseFloat((e.target as HTMLInputElement).value);
    this.values[index] = value;
    this.store.setJointAngles([...this.values]);
  }
}
