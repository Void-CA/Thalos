import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';
import { JointEditor } from '../../shared/components/joint-editor/joint-editor';

type MotionKind = 'movej' | 'movel';

@Component({
  selector: 'planning-panel',
  standalone: true,
  imports: [FormsModule, JointEditor],
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

      <!-- ── MoveJ: JointEditor + actions ── -->
      @if (motionKind() === 'movej') {
        @if (dof() > 0) {
          <div class="planning-panel__section">
            <span class="planning-panel__section-label">
              Joint Targets ({{ dof() }})
            </span>

            <joint-editor #editor />
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
            <button class="planning-panel__reset" (click)="editor.reset()">
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
                  [(ngModel)]="rawInput"
                  placeholder="e.g. 1.0, 0.5, -0.3"
                />
              </label>
              <button
                class="planning-panel__apply-raw"
                (click)="applyRawInput()"
                [disabled]="!rawInput.trim()"
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

  @ViewChild('editor') private readonly editor!: JointEditor;

  protected readonly motionKind = signal<MotionKind>('movej');
  protected readonly motionKinds: MotionKind[] = ['movej', 'movel'];
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** DOF del robot cargado (para @if en template). */
  protected readonly dof = computed(
    () => this.store.state()?.runtime?.robot.joints.length ?? 0,
  );

  // ── Raw input ──

  protected rawInput = '';

  protected applyRawInput(): void {
    const parts = this.rawInput.split(',').map(s => parseFloat(s.trim()));
    if (parts.some(isNaN) || parts.length === 0) return;
    const n = this.dof();
    const adjusted = Array.from({ length: n }, (_, i) => parts[i] ?? 0);
    this.editor.setValues(adjusted);
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
    const parts = this.editor?.values();
    if (!parts || parts.length === 0) return;

    this.error.set(null);
    this.loading.set(true);

    this.api.moveJ(parts, this.parseFloatOpt(this.velocityStr)).subscribe({
      next: res => {
        this.store.applySnapshot(res);
        this.editor.reset();
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'MoveJ failed');
        this.loading.set(false);
      },
    });
  }

  // ── MoveL ──

  protected readonly moveLRotFormat = signal<'euler' | 'quaternion'>('euler');
  protected moveLYawStr = '0';
  protected moveLPitchStr = '0';
  protected moveLRollStr = '0';
  protected moveLQwStr = '1';
  protected moveLQxStr = '0';
  protected moveLQyStr = '0';
  protected moveLQzStr = '0';
  protected txStr = '0.3';
  protected tyStr = '0';
  protected tzStr = '0';
  protected frameIdStr = '';

  protected executeMoveL(): void {
    const tx = this.parseFloatOpt(this.txStr) ?? 0;
    const ty = this.parseFloatOpt(this.tyStr) ?? 0;
    const tz = this.parseFloatOpt(this.tzStr) ?? 0;
    const translation: [number, number, number] = [tx, ty, tz];

    const rotation = this.moveLRotFormat() === 'euler'
      ? {
          kind: 'Ypr' as const,
          value: {
            yaw:   (this.parseFloatOpt(this.moveLYawStr) ?? 0) * Math.PI / 180,
            pitch: (this.parseFloatOpt(this.moveLPitchStr) ?? 0) * Math.PI / 180,
            roll:  (this.parseFloatOpt(this.moveLRollStr) ?? 0) * Math.PI / 180,
          },
        }
      : {
          kind: 'Quaternion' as const,
          value: {
            w: this.parseFloatOpt(this.moveLQwStr) ?? 1,
            x: this.parseFloatOpt(this.moveLQxStr) ?? 0,
            y: this.parseFloatOpt(this.moveLQyStr) ?? 0,
            z: this.parseFloatOpt(this.moveLQzStr) ?? 0,
          },
        };

    this.error.set(null);
    this.loading.set(true);

    this.api.moveL(
      { translation, rotation },
      this.parseIntOpt(this.frameIdStr),
      this.parseFloatOpt(this.velocityStr),
    ).subscribe({
      next: res => {
        this.store.applySnapshot(res);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'MoveL failed');
        this.loading.set(false);
      },
    });
  }
}
