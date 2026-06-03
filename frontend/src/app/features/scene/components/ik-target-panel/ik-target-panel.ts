import { Component, computed, effect, inject, signal } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { IkTarget, IkResult } from '../../scene.types';

/**
 * Panel de control IK.
 *
 * - Inputs X, Y, Z para posición destino
 * - Toggle position / pose (pose añade inputs de quaternion)
 * - Botón "Send" → SceneStore.moveToTarget()
 * - Feedback visual del último IK result
 *
 * Sin subscribe — signals + effects.
 */
@Component({
  selector: 'ik-target-panel',
  standalone: true,
  template: `
    <div class="ik-panel">
      <h3>Inverse Kinematics</h3>

      <!-- Type toggle -->
      <div class="row">
        <label class="toggle">
          <input type="radio" name="ik-type" value="position" [checked]="type() === 'position'" (change)="type.set('position')" />
          Position
        </label>
        <label class="toggle">
          <input type="radio" name="ik-type" value="pose" [checked]="type() === 'pose'" (change)="type.set('pose')" />
          Pose
        </label>
      </div>

      <!-- Position inputs -->
      <label>X <input type="number" step="0.01" [value]="x()" (input)="x.set(+$any($event.target).value)" /></label>
      <label>Y <input type="number" step="0.01" [value]="y()" (input)="y.set(+$any($event.target).value)" /></label>
      <label>Z <input type="number" step="0.01" [value]="z()" (input)="z.set(+$any($event.target).value)" /></label>

      <!-- Rotation inputs (solo en modo pose) -->
      @if (type() === 'pose') {
        <fieldset>
          <legend>Quaternion (w x y z)</legend>
          <label>W <input type="number" step="0.01" [value]="qw()" (input)="qw.set(+$any($event.target).value)" /></label>
          <label>X <input type="number" step="0.01" [value]="qx()" (input)="qx.set(+$any($event.target).value)" /></label>
          <label>Y <input type="number" step="0.01" [value]="qy()" (input)="qy.set(+$any($event.target).value)" /></label>
          <label>Z <input type="number" step="0.01" [value]="qz()" (input)="qz.set(+$any($event.target).value)" /></label>
        </fieldset>
      }

      <!-- Acciones -->
      <div class="actions">
        <button (click)="onPreview()">Preview</button>
        <button class="primary" (click)="onSend()">Send</button>
      </div>

      <!-- Feedback IK result -->
      @if (result(); as r) {
        <div class="feedback" [class.ok]="r.status === 'Converged'" [class.warn]="r.status === 'MaxIterations'">
          <span class="status">{{ r.status }}</span>
          <span class="detail">Iters: {{ r.iterations }}</span>
          <span>Error: {{ r.finalError.toExponential(2) }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
    .ik-panel { font-family: monospace; }
    h3 {
      margin: 0 0 0.75rem;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.7;
    }
    .row { display: flex; gap: 1rem; margin-bottom: 0.5rem; }
    .toggle { font-size: 0.8rem; cursor: pointer; }
    label { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; font-size: 0.8rem; }
    input[type="number"] {
      width: 10ch;
      padding: 0.15rem 0.3rem;
      font-family: monospace;
      font-size: 0.8rem;
      background: #222;
      border: 1px solid #444;
      color: #ddd;
      border-radius: 3px;
    }
    fieldset {
      border: 1px solid #444;
      border-radius: 4px;
      margin: 0.5rem 0;
      padding: 0.4rem 0.6rem;
    }
    legend { font-size: 0.75rem; opacity: 0.6; padding: 0 0.3rem; }
    .actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    button {
      flex: 1;
      padding: 0.3rem 0.6rem;
      font-family: monospace;
      font-size: 0.8rem;
      cursor: pointer;
      background: #333;
      border: 1px solid #555;
      color: #ddd;
      border-radius: 3px;
    }
    button.primary { background: #1a5a9c; border-color: #2a7adf; color: #fff; }
    button:hover { filter: brightness(1.2); }
    .feedback {
      margin-top: 0.5rem;
      padding: 0.3rem 0.5rem;
      border-radius: 3px;
      font-size: 0.75rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .feedback.ok    { background: #0a3a0a; border: 1px solid #2a7a2a; }
    .feedback.warn  { background: #3a2a0a; border: 1px solid #7a5a2a; }
    .status { font-weight: bold; }
    .detail { opacity: 0.7; }
  `,
  ],
})
export class IkTargetPanel {
  private readonly store = inject(SceneStore);

  // ── Local state ──

  protected readonly type = signal<'position' | 'pose'>('position');
  protected readonly x = signal(1.0);
  protected readonly y = signal(1.0);
  protected readonly z = signal(0.0);
  protected readonly qw = signal(1.0);
  protected readonly qx = signal(0);
  protected readonly qy = signal(0);
  protected readonly qz = signal(0);

  // ── Store-derived ──

  protected readonly result = computed<IkResult | null>(() => this.store.state().ikResult);

  // ── Gizmo preview: actualiza el target visual sin llamar API ──

  private buildTarget(): IkTarget {
    return this.type() === 'position'
      ? { type: 'position', translation: [this.x(), this.y(), this.z()] }
      : {
          type: 'pose',
          translation: [this.x(), this.y(), this.z()],
          rotation: [this.qw(), this.qx(), this.qy(), this.qz()],
        };
  }

  protected onPreview(): void {
    this.store.updateTarget(this.buildTarget());
  }

  // ── Send IK command ──

  protected onSend(): void {
    const cmd = this.buildTarget();
    this.store.moveToTarget({ type: cmd.type === 'position' ? 'moveToPosition' : 'moveToPose', target: cmd });
    // Also show gizmo
    this.store.updateTarget(cmd);
  }
}
