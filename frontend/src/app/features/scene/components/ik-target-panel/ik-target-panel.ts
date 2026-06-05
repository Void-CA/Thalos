import { Component, computed, inject, signal } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { IkTarget, IkResult } from '../../scene.types';

/**
 * Panel de control IK con flujo de 3 pasos:
 *
 * 1. **Preview** — mueve solo el gizmo (updateTarget, no API)
 * 2. **Solve** — corre IK en backend, muestra q1..qn, NO mueve el robot
 * 3. **Execute** — aplica los q resueltos y mueve el robot
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

      <!-- 3 botones -->
      <div class="actions">
        <button (click)="onPreview()">Preview</button>
        <button class="solve" (click)="onSolve()">Solve</button>
        <button class="execute" (click)="onExecute()">Execute</button>
      </div>

      <!-- Solved Q display (despues de Solve) -->
      @if (solvedQ(); as q) {
        <div class="solved-q">
          <span class="solved-label">Solved joints</span>
          @for (v of q; track $index) {
            <span class="q-value">q{{ $index + 1 }}: {{ v.toFixed(4) }}</span>
          }
        </div>
      }

      <!-- Feedback IK result -->
      @if (result(); as r) {
        <div class="feedback" [class.ok]="r.status === 'Converged'" [class.warn]="r.status === 'MaxIterations'">
          <span class="status">{{ r.status }}</span>
          <span class="detail">iters: {{ r.iterations }} </span>
          <span class="detail">final error: {{ r.finalError.toFixed(2) }}</span>
        </div>
      }
    </div>
  `,
  styleUrl: './ik-target-panel.scss',
})
export class IkTargetPanel {
  private readonly store = inject(SceneStore);

  // ── Local state ──

  protected readonly type = signal<'position' | 'pose'>('position');
  protected readonly x = signal(0.5);
  protected readonly y = signal(0.5);
  protected readonly z = signal(0.5);
  protected readonly qw = signal(1.0);
  protected readonly qx = signal(0);
  protected readonly qy = signal(0);
  protected readonly qz = signal(0);

  // ── Store-derived ──

  protected readonly result = computed<IkResult | null>(() => this.store.state().ikResult);
  protected readonly solvedQ = computed<number[] | null>(() => this.store.state().solvedQ);

  // ── Build target from form ──

  private buildTarget(): IkTarget {
    return this.type() === 'position'
      ? { type: 'position', translation: [this.x(), this.y(), this.z()] }
      : {
          type: 'pose',
          translation: [this.x(), this.y(), this.z()],
          rotation: [this.qw(), this.qx(), this.qy(), this.qz()],
        };
  }

  // ── Step 1: Preview (gizmo only) ──

  protected onPreview(): void {
    this.store.updateTarget(this.buildTarget());
  }

  // ── Step 2: Solve (IK sin mutación, muestra q) ──

  protected onSolve(): void {
    this.store.updateTarget(this.buildTarget());
    this.store.solveIK(this.buildTarget());
  }

  // ── Step 3: Execute (solve + execute en un solo llamado API) ──

  protected onExecute(): void {
    this.store.updateTarget(this.buildTarget());
    this.store.moveToTarget({
      type: this.type() === 'position' ? 'moveToPosition' : 'moveToPose',
      target: this.buildTarget(),
    });
  }
}
