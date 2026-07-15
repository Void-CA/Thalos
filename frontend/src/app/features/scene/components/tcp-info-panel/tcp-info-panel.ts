import { Component, computed, inject } from '@angular/core';
import { SceneStore } from '../../store/scene.store';

/**
 * Panel informativo que muestra el estado del TCP activo.
 *
 * Fase 2: solo lectura — muestra frame base, offset y posición actual.
 * Fase 4: editable — selector de frame, inputs de offset y botón Aplicar.
 */
@Component({
  selector: 'tcp-info-panel',
  standalone: true,
  template: `
    <div class="tcp-panel">
      @let tcp = activeTcp();
      @if (tcp) {
        <div class="tcp-panel__info">
          <div class="tcp-panel__row">
            <span class="tcp-panel__label">Base frame</span>
            <span class="tcp-panel__value">#{{ tcp.baseFrameId }}</span>
          </div>

          @if (tcp.offset) {
            <div class="tcp-panel__row">
              <span class="tcp-panel__label">Offset</span>
              <span class="tcp-panel__value tcp-panel__value--mono">
                X: {{ tcp.offset[0].toFixed(3) }}
                Y: {{ tcp.offset[1].toFixed(3) }}
                Z: {{ tcp.offset[2].toFixed(3) }}
              </span>
            </div>
          } @else {
            <div class="tcp-panel__row">
              <span class="tcp-panel__label">Offset</span>
              <span class="tcp-panel__value">identity (at frame)</span>
            </div>
          }
        </div>
      } @else {
        <div class="tcp-panel__empty">
          <p class="tcp-panel__hint">No TCP selected — using flange</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .tcp-panel {
      padding: 0.5rem;
    }
    .tcp-panel__info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .tcp-panel__row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8125rem;
      padding: 0.125rem 0;
    }
    .tcp-panel__label {
      color: #999;
    }
    .tcp-panel__value {
      color: #ccc;
      font-weight: 500;
    }
    .tcp-panel__value--mono {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.75rem;
    }
    .tcp-panel__empty {
      padding: 0.5rem;
      text-align: center;
    }
    .tcp-panel__hint {
      margin: 0;
      color: #777;
      font-size: 0.8125rem;
    }
  `],
})
export class TcpInfoPanel {
  private readonly store = inject(SceneStore);
  protected readonly activeTcp = computed(() => this.store.state().activeTcp);
}
