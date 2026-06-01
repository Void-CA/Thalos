import { Component, computed, effect, inject, signal } from '@angular/core';
import { SceneStore } from '../../store/scene.store';

/**
 * Slider driver for joint angles.
 *
 * Se adapta dinámicamente al DOF del robot cargado.
 * Los límites de cada slider vienen del metadata del robot (JointMetadataDto).
 *
 * Sin subscribe ni zone.js:
 *  - joint metadata → computed desde SceneStore.state
 *  - slider values  → writable signal local, se resetea via effect cuando cambia DOF
 */
@Component({
  selector: 'joint-control',
  standalone: true,
  template: `
    <div class="joint-panel">
      <h3>Joints</h3>

      @for (joint of joints(); track $index) {
        <label>
          <span class="joint-label">{{ joint.name }}</span>
          <input
            type="range"
            [min]="joint.min ?? -3.14"
            [max]="joint.max ?? 3.14"
            step="0.01"
            [value]="values()[$index]"
            (input)="onSlider($index, $event)"
          />
          <span class="value">{{ values()[$index].toFixed(2) }}</span>
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

  // ── Señales derivadas del store ──

  /** Metadata de joints del robot activo (nombres, límites). */
  protected readonly joints = computed(() =>
    this.store.state()?.runtime?.robot?.joints ?? [],
  );

  /** Valores locales de cada slider. */
  private readonly localValues = signal<number[]>([]);

  /** Exposición readonly para el template. */
  protected readonly values = this.localValues.asReadonly();

  // ── Sincronización reactiva ──

  /** Track del DOF anterior para resetear valores cuando cambia el robot. */
  private readonly prevDof = signal(0);

  constructor() {
    // Cada vez que cambia el robot (distinto DOF), reseteamos valores desde el store
    effect(() => {
      const runtime = this.store.state()?.runtime;
      if (runtime) {
        const dof = runtime.robot.joints.length;
        if (dof !== this.prevDof()) {
          this.prevDof.set(dof);
          this.localValues.set([...runtime.joints]);
        }
      }
    });
  }

  // ── Acciones ──

  protected onSlider(index: number, e: Event): void {
    const value = parseFloat((e.target as HTMLInputElement).value);
    const next = [...this.localValues()];
    next[index] = value;
    this.localValues.set(next);
    this.store.setJointAngles(next);
  }
}
