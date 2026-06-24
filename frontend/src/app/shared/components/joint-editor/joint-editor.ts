import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { SceneStore } from '../../../features/scene/store/scene.store';

export interface JointEntry {
  name: string;
  value: number;
  min: number;
  max: number;
}

/**
 * JointEditor — fuente de verdad de valores articulares.
 *
 * Lee metadata + valores actuales del SceneStore, renderiza sliders y
 * number inputs. Cada padre decide qué hacer con los valores:
 *
 *   - FK panel (JointControl): escucha `valueChange` → setJointAngles() en cada cambio
 *   - Planning (MoveJ): lee `values()` solo al ejecutar
 *
 * Uso:
 *   <joint-editor #editor (valueChange)="onJointChange($event)" />
 *   editor.values()     → señal readonly con valores actuales
 *   editor.reset()      → sincroniza desde runtime.joints
 */
@Component({
  selector: 'joint-editor',
  standalone: true,
  template: `
    @for (entry of entries(); track $index; let i = $index) {
      <div class="je-row">
        <span class="je-row__name">{{ entry.name }}</span>
        <input
          type="range"
          class="je-row__slider"
          [min]="entry.min"
          [max]="entry.max"
          step="0.01"
          [value]="entry.value"
          (input)="onChange(i, $event)"
        />
        <input
          type="number"
          class="je-row__number"
          [min]="entry.min"
          [max]="entry.max"
          step="0.01"
          [value]="entry.value"
          (input)="onChange(i, $event)"
        />
      </div>
    }
  `,
  styles: [
    // encapsulated styles — no leak to parent
    `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .je-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0;
    }

    .je-row__name {
      width: 48px;
      font-size: 0.7rem;
      color: #c0c0c0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
      font-family: monospace;
    }

    .je-row__slider {
      flex: 1;
      min-width: 0;
      height: 4px;
      appearance: none;
      -webkit-appearance: none;
      background: #444;
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .je-row__slider::-webkit-slider-thumb {
      appearance: none;
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #3399ff;
      border: 2px solid #1e1e1e;
      cursor: pointer;
      transition: filter 0.15s;
    }

    .je-row__slider::-webkit-slider-thumb:hover {
      filter: brightness(1.3);
    }

    .je-row__slider::-moz-range-thumb {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #3399ff;
      border: 2px solid #1e1e1e;
      cursor: pointer;
    }

    .je-row__number {
      width: 70px;
      flex-shrink: 0;
      text-align: left;
      padding: 0.2rem 0.3rem;
      font-family: monospace;
      font-size: 0.8rem;
      background: #222;
      border: 1px solid #444;
      color: #ddd;
      border-radius: 3px;
    }
    `,
  ],
})
export class JointEditor {
  private readonly store = inject(SceneStore);

  // ── Fuente de verdad ──
  readonly values = signal<number[]>([]);

  // ── Entradas para sliders (derivado) ──
  readonly entries = computed<JointEntry[]>(() => {
    const r = this.store.state()?.runtime;
    if (!r) return [];
    const meta = r.robot.joints;
    const vals = this.values();
    return meta.map((j, i) => ({
      name: j.name || `J${i + 1}`,
      value: vals[i] ?? 0,
      min: j.min ?? -Math.PI,
      max: j.max ?? Math.PI,
    }));
  });

  // ── Emite el ARRAY COMPLETO en cada cambio — el padre decide qué hacer ──
  readonly valueChange = output<number[]>();

  // ── Track de DOF para resetear cuando cambia el robot ──
  private readonly prevDof = signal(0);

  constructor() {
    effect(() => {
      const r = this.store.state()?.runtime;
      if (r) {
        // Use `dof` (actuated joints) instead of `joints.length`
        // because URDF metadata includes entries for fixed joints.
        const dof = r.robot.dof;
        if (dof !== this.prevDof()) {
          this.prevDof.set(dof);
          this.values.set([...r.joints]);
        }
      }
    });
  }

  // ── Público ──

  /** DOF actual (derivado del robot cargado). */
  readonly dof = computed(() => this.store.state()?.runtime?.robot.dof ?? 0);

  /** Sincroniza valores desde runtime.joints. */
  reset(): void {
    const r = this.store.state()?.runtime;
    if (r) {
      this.values.set([...r.joints]);
    }
  }

  /** Setea valores programáticamente (raw input, etc.). */
  setValues(v: number[]): void {
    this.values.set(v);
  }

  // ── Template handlers ──

  protected onChange(index: number, event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    if (!isFinite(value)) return;

    this.values.update(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });

    this.valueChange.emit(this.values());
  }
}
