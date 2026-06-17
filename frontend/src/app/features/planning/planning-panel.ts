import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';
import { JointSlider, JointSliderEntry } from '../../shared/components/joint-slider/joint-slider';
import type { JointMetadataDto } from '../robots/robot-api.types';

type MotionKind = 'movej' | 'movel';

@Component({
  selector: 'planning-panel',
  standalone: true,
  imports: [FormsModule, JointSlider],
  template: `
    <div class="planning-panel">
      <!-- Motion type selector -->
      <div class="planning-panel__tabs">
        @for (kind of motionKinds; track kind) {
          <button
            class="planning-panel__tab"
            [class.active]="motionKind() === kind"
            (click)="motionKind.set(kind)"
          >
            {{ kind === 'movej' ? 'MoveJ' : 'MoveL' }}
          </button>
        }
      </div>

      <!-- ── MoveJ: per-joint sliders + number inputs ── -->
      @if (motionKind() === 'movej') {
        @let joints = jointMeta();
        @if (joints.length > 0) {
          <div class="planning-panel__section">
            <span class="planning-panel__section-label">
              Joint Targets ({{ dof() }})
            </span>

            <joint-slider
              [joints]="sliderEntries()"
              (valueChange)="setJoint($event.index, $event.value)"
            />
          </div>

          <!-- Velocity -->
          <label class="planning-panel__field">
            <span class="planning-panel__label">Velocity (optional)</span>
            <input
              class="planning-panel__input"
              type="number"
              step="0.1"
              min="0.01"
              [(ngModel)]="velocityStr"
              placeholder="default"
            />
          </label>

          <!-- Actions -->
          <div class="planning-panel__actions">
            <button class="planning-panel__reset" (click)="resetToCurrent()">
              Reset
            </button>
            <button
              class="planning-panel__submit"
              (click)="executeMoveJ()"
              [disabled]="loading()"
            >
              {{ loading() ? 'Executing…' : 'Execute MoveJ' }}
            </button>
          </div>

          <!-- Advanced: raw CSV input for power users -->
          <details class="planning-panel__advanced">
            <summary class="planning-panel__advanced-summary">Raw Input</summary>
            <div class="planning-panel__advanced-body">
              <label class="planning-panel__field">
                <span class="planning-panel__label">Comma-separated joints</span>
                <input
                  class="planning-panel__input"
                  type="text"
                  [(ngModel)]="jointsInput"
                  placeholder="e.g. 1.0, 0.5, -0.3"
                />
              </label>
              <button
                class="planning-panel__apply-raw"
                (click)="applyRawInput()"
                [disabled]="!jointsInput.trim()"
              >
                Apply Raw
              </button>
            </div>
          </details>
        } @else {
          <div class="planning-panel__empty">
            <p>No robot loaded.</p>
            <p class="planning-panel__empty-hint">
              Select a robot from the catalog to start planning.
            </p>
          </div>
        }
      }

      <!-- ── MoveL form (IK-style card inputs) ── -->
      @if (motionKind() === 'movel') {
        <section class="planning-panel__card">
          <h4 class="planning-panel__card-label">Target</h4>

          <!-- Translation coord grid -->
          <div class="planning-panel__coord-grid">
            <label>X
              <input type="number" step="0.01" [(ngModel)]="txStr" />
            </label>
            <label>Y
              <input type="number" step="0.01" [(ngModel)]="tyStr" />
            </label>
            <label>Z
              <input type="number" step="0.01" [(ngModel)]="tzStr" />
            </label>
          </div>

          <!-- Rotation with format toggle -->
          <div class="planning-panel__rotation">
            <div class="segmented" role="radiogroup" aria-label="Rotation format">
              <button
                type="button"
                role="radio"
                class="segmented__btn"
                [class.is-active]="moveLRotFormat() === 'euler'"
                (click)="moveLRotFormat.set('euler')"
              >Euler</button>
              <button
                type="button"
                role="radio"
                class="segmented__btn"
                [class.is-active]="moveLRotFormat() === 'quaternion'"
                (click)="moveLRotFormat.set('quaternion')"
              >Quaternion</button>
            </div>

            @if (moveLRotFormat() === 'euler') {
              <div class="planning-panel__coord-grid">
                <label>Yaw °
                  <input type="number" step="1" [(ngModel)]="moveLYawStr" />
                </label>
                <label>Pitch °
                  <input type="number" step="1" [(ngModel)]="moveLPitchStr" />
                </label>
                <label>Roll °
                  <input type="number" step="1" [(ngModel)]="moveLRollStr" />
                </label>
              </div>
            } @else {
              <div class="planning-panel__coord-grid planning-panel__coord-grid--quat">
                <label>W
                  <input type="number" step="0.01" [(ngModel)]="moveLQwStr" />
                </label>
                <label>X
                  <input type="number" step="0.01" [(ngModel)]="moveLQxStr" />
                </label>
                <label>Y
                  <input type="number" step="0.01" [(ngModel)]="moveLQyStr" />
                </label>
                <label>Z
                  <input type="number" step="0.01" [(ngModel)]="moveLQzStr" />
                </label>
              </div>
            }
          </div>

          <!-- Options -->
          <label class="planning-panel__field">
            <span class="planning-panel__label">Frame ID (optional)</span>
            <input class="planning-panel__input" type="number" step="1" min="0" [(ngModel)]="frameIdStr" placeholder="0" />
          </label>
          <label class="planning-panel__field">
            <span class="planning-panel__label">Velocity (optional)</span>
            <input class="planning-panel__input" type="number" step="0.1" min="0.01" [(ngModel)]="velocityStr" placeholder="default" />
          </label>
        </section>

        <!-- Actions -->
        <div class="planning-panel__actions">
          <button class="planning-panel__submit" (click)="executeMoveL()" [disabled]="loading()">
            {{ loading() ? 'Executing…' : 'Execute MoveL' }}
          </button>
        </div>
      }

      <!-- Error display -->
      @if (error()) {
        <div class="planning-panel__error">{{ error() }}</div>
      }
    </div>
  `,
  styleUrl: './planning-panel.scss',
})
export class PlanningPanel {
  private readonly api = inject(SceneApiService);
  private readonly store = inject(SceneStore);

  protected readonly motionKind = signal<MotionKind>('movej');
  protected readonly motionKinds: MotionKind[] = ['movej', 'movel'];
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Joint values the user is editing — mirrors robot DOF. */
  protected readonly jointValues = signal<number[]>([]);

  /** Number of joints (derived). */
  protected readonly dof = computed(() => this.jointValues().length);

  /** Build JointSliderEntry[] from runtime metadata + local values. */
  protected readonly sliderEntries = computed<JointSliderEntry[]>(() => {
    const r = this.store.state()?.runtime;
    if (!r) return [];
    const vals = this.jointValues();
    return r.robot.joints.map((j: JointMetadataDto, i: number) => ({
      name: j.name || `J${i + 1}`,
      value: vals[i] ?? 0,
      min: j.min ?? -Math.PI,
      max: j.max ?? Math.PI,
    }));
  });

  /** Sync sliders from the robot's current joint angles. */
  private syncFromRuntime(): void {
    const r = this.store.state()?.runtime;
    if (r) {
      this.jointValues.set([...r.joints]);
    }
  }

  constructor() {
    this.syncFromRuntime();
  }

  // ── Joint editing ──

  protected setJoint(index: number, value: number): void {
    this.jointValues.update(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  protected resetToCurrent(): void {
    this.syncFromRuntime();
  }

  // ── Raw input for power users ──

  protected jointsInput = '';

  protected applyRawInput(): void {
    const parts = this.jointsInput.split(',').map(s => parseFloat(s.trim()));
    if (parts.some(isNaN) || parts.length === 0) return;
    const dof = this.dof();
    const adjusted = Array.from({ length: dof }, (_, i) => parts[i] ?? 0);
    this.jointValues.set(adjusted);
  }

  // ── Velocity (shared MoveJ / MoveL) ──

  protected velocityStr = '';

  private parseFloatOpt(s: string): number | undefined {
    const v = parseFloat(s);
    return isFinite(v) ? v : undefined;
  }

  private parseIntOpt(s: string): number | undefined {
    const v = parseInt(s, 10);
    return isFinite(v) ? v : undefined;
  }

  // ── Execution ──

  protected executeMoveJ(): void {
    const parts = this.jointValues();
    if (parts.length === 0) return;

    this.error.set(null);
    this.loading.set(true);

    this.api.moveJ(parts, this.parseFloatOpt(this.velocityStr)).subscribe({
      next: res => {
        this.store.applySnapshot(res);
        this.syncFromRuntime();
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'MoveJ failed');
        this.loading.set(false);
      },
    });
  }

  // ── MoveL (unchanged) ──

  protected txStr = '0.3';
  protected tyStr = '0';
  protected tzStr = '0';
  protected qwStr = '1';
  protected qxStr = '0';
  protected qyStr = '0';
  protected qzStr = '0';
  protected frameIdStr = '';

  protected executeMoveL(): void {
    const tx = this.parseFloatOpt(this.txStr) ?? 0;
    const ty = this.parseFloatOpt(this.tyStr) ?? 0;
    const tz = this.parseFloatOpt(this.tzStr) ?? 0;
    const translation: [number, number, number] = [tx, ty, tz];

    const qw = this.parseFloatOpt(this.qwStr) ?? 1;
    const qx = this.parseFloatOpt(this.qxStr) ?? 0;
    const qy = this.parseFloatOpt(this.qyStr) ?? 0;
    const qz = this.parseFloatOpt(this.qzStr) ?? 0;
    const rotation = { kind: 'Quaternion' as const, value: { w: qw, x: qx, y: qy, z: qz } };

    this.error.set(null);
    this.loading.set(true);

    this.api.moveL(
      { translation, rotation },
      this.parseIntOpt(this.frameIdStr),
      this.parseFloatOpt(this.velocityStr),
    ).subscribe({
      next: res => {
        this.store.applySnapshot(res);
        this.syncFromRuntime();
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'MoveL failed');
        this.loading.set(false);
      },
    });
  }
}
