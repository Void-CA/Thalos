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
        <button
          class="execute"
          [disabled]="!solvedQ()"
          (click)="onExecute()"
        >Execute</button>
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
          <span class="detail">{{ r.iterations }} iters · err {{ r.finalError.toExponential(2) }}</span>
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
      width: 8ch;
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
    .actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
    button {
      flex: 1;
      padding: 0.3rem 0.4rem;
      font-family: monospace;
      font-size: 0.75rem;
      cursor: pointer;
      background: #333;
      border: 1px solid #555;
      color: #ddd;
      border-radius: 3px;
    }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    button.solve   { background: #1a5a9c; border-color: #2a7adf; color: #fff; }
    button.execute { background: #3a7a3a; border-color: #5aaa5a; color: #fff; }
    button:hover:not(:disabled) { filter: brightness(1.2); }
    .solved-q {
      margin-top: 0.5rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 0.6rem;
    }
    .solved-label {
      width: 100%;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.6;
      margin-bottom: 0.15rem;
    }
    .q-value {
      font-size: 0.8rem;
      background: #1a2a1a;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      border: 1px solid #2a4a2a;
    }
    .feedback {
      margin-top: 0.5rem;
      padding: 0.3rem 0.5rem;
      border-radius: 3px;
      font-size: 0.75rem;
      display: flex;
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
  protected readonly x = signal(2.0);
  protected readonly y = signal(1.0);
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

  // ── Step 3: Execute (aplica q resueltos, mueve robot) ──

  protected onExecute(): void {
    const q = this.solvedQ();
    if (q) {
      this.store.executeIK(q);
    }
  }
}
