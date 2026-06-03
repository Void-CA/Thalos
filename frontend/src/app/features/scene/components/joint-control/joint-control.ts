import { Component, computed, effect, inject, signal } from '@angular/core';
import { SceneStore } from '../../store/scene.store';


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
  styleUrl: './joint-control.scss',
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
