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
  styleUrl: './tcp-info-panel.scss',
})
export class TcpInfoPanel {
  private readonly store = inject(SceneStore);
  protected readonly activeTcp = computed(() => this.store.state().activeTcp);
}
