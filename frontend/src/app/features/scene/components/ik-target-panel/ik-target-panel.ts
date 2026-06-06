import { Component, computed, inject, signal } from '@angular/core';
import { SceneStore } from '../../store/scene.store';
import { IkTarget, IkResult } from '../../scene.types';
import type { RotationDto } from '../../scene-api.types';

/**
 * Panel de control IK con flujo de 3 pasos:
 *
 * 1. **Preview** — mueve solo el gizmo (updateTarget, no API)
 * 2. **Solve** — corre IK en backend, muestra q1..qn, NO mueve el robot
 * 3. **Execute** — aplica los q resueltos y mueve el robot
 *
 * Layout en 3 cards visuales:
 *  - **Inputs**: tipo de target + coords + (rotación si pose)
 *  - **Actions**: Preview / Solve / Execute
 *  - **Outputs**: resultados de solo lectura (joints resueltos + status)
 *
 * Sin subscribe — signals + effects.
 */
@Component({
  selector: 'ik-target-panel',
  standalone: true,
  template: `
    <div class="ik-panel">
      <!-- ── INPUTS ── -->
      <section class="ik-panel__inputs" aria-labelledby="ik-inputs-label">
        <h4 id="ik-inputs-label" class="ik-panel__label">Target</h4>

        <!-- Type segmented control -->
        <div
          class="segmented"
          role="radiogroup"
          aria-label="IK target type"
        >
          <button
            type="button"
            role="radio"
            class="segmented__btn"
            [class.is-active]="type() === 'position'"
            [attr.aria-checked]="type() === 'position'"
            (click)="type.set('position')"
          >
            Position
          </button>
          <button
            type="button"
            role="radio"
            class="segmented__btn"
            [class.is-active]="type() === 'pose'"
            [attr.aria-checked]="type() === 'pose'"
            (click)="type.set('pose')"
          >
            Pose
          </button>
        </div>

        <!-- Position coords (always visible) -->
        <div class="coord-grid">
          <label>X
            <input type="number" step="0.01" [value]="x()" (input)="x.set(+$any($event.target).value)" />
          </label>
          <label>Y
            <input type="number" step="0.01" [value]="y()" (input)="y.set(+$any($event.target).value)" />
          </label>
          <label>Z
            <input type="number" step="0.01" [value]="z()" (input)="z.set(+$any($event.target).value)" />
          </label>
        </div>

        <!-- Rotation: progressive disclosure — only when Pose -->
        @if (type() === 'pose') {
          <div class="rotation">
            <h5 class="ik-panel__sublabel">Rotation</h5>

            <div
              class="segmented segmented--small"
              role="radiogroup"
              aria-label="Rotation format"
            >
              <button
                type="button"
                role="radio"
                class="segmented__btn"
                [class.is-active]="rotationFormat() === 'ypr'"
                [attr.aria-checked]="rotationFormat() === 'ypr'"
                (click)="rotationFormat.set('ypr')"
              >
                Euler
              </button>
              <button
                type="button"
                role="radio"
                class="segmented__btn"
                [class.is-active]="rotationFormat() === 'quaternion'"
                [attr.aria-checked]="rotationFormat() === 'quaternion'"
                (click)="rotationFormat.set('quaternion')"
              >
                Quaternion
              </button>
            </div>

            @if (rotationFormat() === 'ypr') {
              <div class="coord-grid">
                <label>Yaw (Z) °
                  <input type="number" step="1" [value]="yawDeg()"   (input)="yawDeg.set(+$any($event.target).value)" />
                </label>
                <label>Pitch (Y) °
                  <input type="number" step="1" [value]="pitchDeg()" (input)="pitchDeg.set(+$any($event.target).value)" />
                </label>
                <label>Roll (X) °
                  <input type="number" step="1" [value]="rollDeg()"  (input)="rollDeg.set(+$any($event.target).value)" />
                </label>
              </div>
            } @else {
              <div class="coord-grid coord-grid--quaternion">
                <label>W
                  <input type="number" step="0.01" [value]="qw()" (input)="qw.set(+$any($event.target).value)" />
                </label>
                <label>X
                  <input type="number" step="0.01" [value]="qx()" (input)="qx.set(+$any($event.target).value)" />
                </label>
                <label>Y
                  <input type="number" step="0.01" [value]="qy()" (input)="qy.set(+$any($event.target).value)" />
                </label>
                <label>Z
                  <input type="number" step="0.01" [value]="qz()" (input)="qz.set(+$any($event.target).value)" />
                </label>
              </div>
            }
          </div>
        }
      </section>

      <!-- ── ACTIONS ── -->
      <section class="ik-panel__actions" aria-label="IK actions">
        <button type="button" class="action" (click)="onPreview()">Preview</button>
        <button type="button" class="action action--solve" (click)="onSolve()">Solve</button>
        <button type="button" class="action action--execute" (click)="onExecute()">Execute</button>
      </section>

      <!-- ── OUTPUTS ── -->
      <section class="ik-panel__outputs" aria-labelledby="ik-outputs-label">
        <h4 id="ik-outputs-label" class="ik-panel__label">Results</h4>

        @if (solvedQ(); as q) {
          <div class="solved-q">
            <span class="solved-q__label">Solved joints</span>
            <div class="solved-q__chips">
              @for (v of q; track $index) {
                <span class="q-value">q{{ $index + 1 }}: {{ v.toFixed(4) }}</span>
              }
            </div>
          </div>
        } @else {
          <p class="solved-q__empty">No solution yet</p>
        }

        @if (result(); as r) {
          <div
            class="feedback"
            [class.feedback--ok]="r.status === 'Converged'"
            [class.feedback--warn]="r.status === 'MaxIterations'"
          >
            <span class="feedback__status">{{ r.status }}</span>
            <span class="feedback__detail">iters: {{ r.iterations }}</span>
            <span class="feedback__detail">final error: {{ r.finalError.toFixed(2) }}</span>
          </div>
        }
      </section>
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

  /** Rotation input format. YPR is the default — it matches how humans
   *  intuitively describe orientation. The wire format sent to the API
   *  is the tagged enum `RotationDto`; the math (quaternion ↔ Euler)
   *  is owned by `thalos_core::UnitQuaternion`, not by this component. */
  protected readonly rotationFormat = signal<'ypr' | 'quaternion'>('ypr');

  /** YPR inputs in DEGREES — converted to radians at submit time. */
  protected readonly yawDeg = signal(0);
  protected readonly pitchDeg = signal(0);
  protected readonly rollDeg = signal(0);

  /** Quaternion inputs as raw values. */
  protected readonly qw = signal(1.0);
  protected readonly qx = signal(0);
  protected readonly qy = signal(0);
  protected readonly qz = signal(0);

  // ── Store-derived ──

  protected readonly result = computed<IkResult | null>(() => this.store.state().ikResult);
  protected readonly solvedQ = computed<number[] | null>(() => this.store.state().solvedQ);

  // ── Build target from form ──

  private buildTarget(): IkTarget {
    if (this.type() === 'position') {
      return { type: 'position', translation: [this.x(), this.y(), this.z()] };
    }

    const rotation: RotationDto =
      this.rotationFormat() === 'ypr'
        ? {
            kind: 'Ypr',
            value: {
              yaw:   this.yawDeg()   * Math.PI / 180,
              pitch: this.pitchDeg() * Math.PI / 180,
              roll:  this.rollDeg()  * Math.PI / 180,
            },
          }
        : {
            kind: 'Quaternion',
            value: { w: this.qw(), x: this.qx(), y: this.qy(), z: this.qz() },
          };

    return {
      type: 'pose',
      translation: [this.x(), this.y(), this.z()],
      rotation,
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
