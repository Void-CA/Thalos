import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';

type MotionKind = 'movej' | 'movel';

@Component({
  selector: 'planning-panel',
  standalone: true,
  imports: [FormsModule],
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

      <!-- MoveJ form -->
      @if (motionKind() === 'movej') {
        <div class="planning-panel__form">
          <label class="planning-panel__field">
            <span class="planning-panel__label">Target Joints</span>
            <input
              class="planning-panel__input"
              type="text"
              [(ngModel)]="jointsInput"
              placeholder="e.g. 1.0, 0.5, -0.3"
            />
          </label>
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
          <button
            class="planning-panel__submit"
            (click)="executeMoveJ()"
            [disabled]="!jointsInput.trim() || loading()"
          >
            {{ loading() ? 'Executing…' : 'Execute MoveJ' }}
          </button>
        </div>
      }

      <!-- MoveL form -->
      @if (motionKind() === 'movel') {
        <div class="planning-panel__form">
          <fieldset class="planning-panel__fieldset">
            <legend class="planning-panel__legend">Translation</legend>
            <div class="planning-panel__row">
              <label>
                <span class="planning-panel__label--inline">X</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="txStr" />
              </label>
              <label>
                <span class="planning-panel__label--inline">Y</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="tyStr" />
              </label>
              <label>
                <span class="planning-panel__label--inline">Z</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="tzStr" />
              </label>
            </div>
          </fieldset>

          <fieldset class="planning-panel__fieldset">
            <legend class="planning-panel__legend">Rotation (quaternion)</legend>
            <div class="planning-panel__row">
              <label>
                <span class="planning-panel__label--inline">W</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="qwStr" />
              </label>
              <label>
                <span class="planning-panel__label--inline">X</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="qxStr" />
              </label>
              <label>
                <span class="planning-panel__label--inline">Y</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="qyStr" />
              </label>
              <label>
                <span class="planning-panel__label--inline">Z</span>
                <input class="planning-panel__input--inline" type="number" step="0.1" [(ngModel)]="qzStr" />
              </label>
            </div>
          </fieldset>

          <label class="planning-panel__field">
            <span class="planning-panel__label">Frame ID (optional)</span>
            <input
              class="planning-panel__input"
              type="number"
              step="1"
              min="0"
              [(ngModel)]="frameIdStr"
              placeholder="0"
            />
          </label>

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

          <button
            class="planning-panel__submit"
            (click)="executeMoveL()"
            [disabled]="loading()"
          >
            {{ loading() ? 'Executing…' : 'Execute MoveL' }}
          </button>
        </div>
      }

      <!-- Result display -->
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

  // Form fields as strings (ngModel-friendly)
  protected jointsInput = '';
  protected velocityStr = '';
  protected txStr = '0.3';
  protected tyStr = '0';
  protected tzStr = '0';
  protected qwStr = '1';
  protected qxStr = '0';
  protected qyStr = '0';
  protected qzStr = '0';
  protected frameIdStr = '';

  private parseFloatOpt(s: string): number | undefined {
    const v = parseFloat(s);
    return isFinite(v) ? v : undefined;
  }

  private parseIntOpt(s: string): number | undefined {
    const v = parseInt(s, 10);
    return isFinite(v) ? v : undefined;
  }

  protected executeMoveJ(): void {
    const parts = this.jointsInput.split(',').map(s => parseFloat(s.trim()));
    if (parts.some(isNaN) || parts.length === 0) {
      this.error.set('Invalid joint values. Use comma-separated numbers.');
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    this.api.moveJ(parts, this.parseFloatOpt(this.velocityStr)).subscribe({
      next: res => {
        this.store.applySnapshot(res);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'MoveJ failed');
        this.loading.set(false);
      },
    });
  }

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
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message ?? 'MoveL failed');
        this.loading.set(false);
      },
    });
  }
}
