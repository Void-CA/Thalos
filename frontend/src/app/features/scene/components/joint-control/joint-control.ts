import { Component, inject } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { JointEditor } from '../../../../shared/components/joint-editor/joint-editor';

/**
 * Panel FK — usa JointEditor como fuente de verdad de valores articulares.
 *
 * Escucha `valueChange` con el array completo para enviar FK al store
 * en TIEMPO REAL (cada vez que el usuario mueve un slider).
 */
@Component({
  selector: 'joint-control',
  standalone: true,
  imports: [JointEditor],
  template: `
    <div class="joint-panel">
      <h3>Joints</h3>
      <joint-editor (valueChange)="onJointChange($event)" />
    </div>
  `,
  styleUrl: './joint-control.scss',
})
export class JointControl {
  private readonly store = inject(SceneStore);

  /** Cada cambio en joints → FK en tiempo real. */
  protected onJointChange(values: number[]): void {
    this.store.setJointAngles(values);
  }
}
