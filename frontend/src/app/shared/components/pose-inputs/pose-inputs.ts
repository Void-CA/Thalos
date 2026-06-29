import { Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface PoseInputsValue {
  translation: [number, number, number];
  rotationFormat: 'euler' | 'quaternion';
  yprDeg: [number, number, number];
  quaternion: [number, number, number, number];
}

/**
 * PoseInputs — inputs reutilizables de posición + rotación.
 *
 * Usado por IkTargetPanel (modo IK) y PlanningPanel (segmentos MoveL).
 * NO incluye botones de acción — solo los formularios de entrada.
 *
 * Uso:
 *   <pose-inputs
 *     [value]="myPose"
 *     [showTypeSelector]="true"
 *     (valueChange)="onPoseChange($event)"
 *   />
 */
@Component({
  selector: 'pose-inputs',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="pose-inputs">
      @if (showTypeSelector()) {
        <!-- Type segmented control (IK mode) -->
        <div class="segmented" role="radiogroup" aria-label="Target type">
          <button
            type="button"
            role="radio"
            class="segmented__btn"
            [class.is-active]="localType() === 'position'"
            (click)="localType.set('position'); emit()"
          >Position</button>
          <button
            type="button"
            role="radio"
            class="segmented__btn"
            [class.is-active]="localType() === 'pose'"
            (click)="localType.set('pose'); emit()"
          >Pose</button>
        </div>
      }

      <!-- Position coords -->
      <div class="coord-grid">
        <label>X
          <input type="number" step="0.01" [value]="localX()" (input)="localX.set(+$any($event.target).value); emit()" />
        </label>
        <label>Y
          <input type="number" step="0.01" [value]="localY()" (input)="localY.set(+$any($event.target).value); emit()" />
        </label>
        <label>Z
          <input type="number" step="0.01" [value]="localZ()" (input)="localZ.set(+$any($event.target).value); emit()" />
        </label>
      </div>

      <!-- Rotation: always visible when showTypeSelector=false (MoveL),
           or only when type=pose in IK mode -->
      @if (!showTypeSelector() || localType() === 'pose') {
        <div class="rotation">
          <div class="segmented segmented--small" role="radiogroup" aria-label="Rotation format">
            <button
              type="button"
              role="radio"
              class="segmented__btn"
              [class.is-active]="localRotFormat() === 'euler'"
              (click)="localRotFormat.set('euler'); emit()"
            >Euler</button>
            <button
              type="button"
              role="radio"
              class="segmented__btn"
              [class.is-active]="localRotFormat() === 'quaternion'"
              (click)="localRotFormat.set('quaternion'); emit()"
            >Quaternion</button>
          </div>

          @if (localRotFormat() === 'euler') {
            <div class="coord-grid">
              <label>Yaw (Z) °
                <input type="number" step="1" [value]="localYaw()" (input)="localYaw.set(+$any($event.target).value); emit()" />
              </label>
              <label>Pitch (Y) °
                <input type="number" step="1" [value]="localPitch()" (input)="localPitch.set(+$any($event.target).value); emit()" />
              </label>
              <label>Roll (X) °
                <input type="number" step="1" [value]="localRoll()" (input)="localRoll.set(+$any($event.target).value); emit()" />
              </label>
            </div>
          } @else {
            <div class="coord-grid coord-grid--quaternion">
              <label>W
                <input type="number" step="0.01" [value]="localQw()" (input)="localQw.set(+$any($event.target).value); emit()" />
              </label>
              <label>X
                <input type="number" step="0.01" [value]="localQx()" (input)="localQx.set(+$any($event.target).value); emit()" />
              </label>
              <label>Y
                <input type="number" step="0.01" [value]="localQy()" (input)="localQy.set(+$any($event.target).value); emit()" />
              </label>
              <label>Z
                <input type="number" step="0.01" [value]="localQz()" (input)="localQz.set(+$any($event.target).value); emit()" />
              </label>
            </div>
          }
        </div>
      }

      @if (showFrameId()) {
        <label class="pose-inputs__field">
          <span>Frame ID (optional)</span>
          <input type="number" step="1" min="0" [value]="localFrameId()"
            (input)="localFrameId.set(+$any($event.target).value); emit()" placeholder="0" />
        </label>
      }
    </div>
  `,
  styleUrl: './pose-inputs.scss',
})
export class PoseInputs {
  /** Whether to show the Position/Pose type selector. Default: true. */
  readonly showTypeSelector = input(true);

  /** Whether to show the Frame ID input. Default: false. */
  readonly showFrameId = input(false);

  /** Emitted whenever any input value changes. */
  readonly valueChange = output<PoseInputsValue>();

  // ── Internal state (initialized from value input or defaults) ──

  protected readonly localType = signal<'position' | 'pose'>('position');
  protected readonly localX = signal(0.5);
  protected readonly localY = signal(0.5);
  protected readonly localZ = signal(0.5);
  protected readonly localRotFormat = signal<'euler' | 'quaternion'>('euler');
  protected readonly localYaw = signal(0);
  protected readonly localPitch = signal(0);
  protected readonly localRoll = signal(0);
  protected readonly localQw = signal(1);
  protected readonly localQx = signal(0);
  protected readonly localQy = signal(0);
  protected readonly localQz = signal(0);
  protected readonly localFrameId = signal(0);
  private initialStateApplied = false;

  /** Optional initial value — applied once on creation. */
  readonly value = input<PoseInputsValue | undefined>(undefined);

  constructor() {
    effect(() => {
      const v = this.value();
      if (v && !this.initialStateApplied) {
        this.initialStateApplied = true;
        this.localType.set(v.translation[0] !== undefined || v.translation[1] !== undefined || v.translation[2] !== undefined ? 'pose' : 'position');
        this.localX.set(v.translation[0]);
        this.localY.set(v.translation[1]);
        this.localZ.set(v.translation[2]);
        this.localRotFormat.set(v.rotationFormat);
        this.localYaw.set(v.yprDeg[0]);
        this.localPitch.set(v.yprDeg[1]);
        this.localRoll.set(v.yprDeg[2]);
        this.localQw.set(v.quaternion[0]);
        this.localQx.set(v.quaternion[1]);
        this.localQy.set(v.quaternion[2]);
        this.localQz.set(v.quaternion[3]);
      }
    });
  }

  protected emit(): void {
    this.valueChange.emit({
      translation: [this.localX(), this.localY(), this.localZ()],
      rotationFormat: this.localRotFormat(),
      yprDeg: [this.localYaw(), this.localPitch(), this.localRoll()],
      quaternion: [this.localQw(), this.localQx(), this.localQy(), this.localQz()],
    });
  }

  /** Reset all inputs to given values. */
  setValues(v: PoseInputsValue): void {
    this.localX.set(v.translation[0]);
    this.localY.set(v.translation[1]);
    this.localZ.set(v.translation[2]);
    this.localRotFormat.set(v.rotationFormat);
    this.localYaw.set(v.yprDeg[0]);
    this.localPitch.set(v.yprDeg[1]);
    this.localRoll.set(v.yprDeg[2]);
    this.localQw.set(v.quaternion[0]);
    this.localQx.set(v.quaternion[1]);
    this.localQy.set(v.quaternion[2]);
    this.localQz.set(v.quaternion[3]);
  }
}
