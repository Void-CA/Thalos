import { Component, input, output, signal } from '@angular/core';
import type { RobotMetadataDto } from '../../robot-api.types';

/**
 * Popup emergente para descargar el URDF de un robot.
 * Muestra modelo, badge URDF, tamaño placeholder y botón de descarga.
 * Hace anchor absoluto sobre el card padre vía CSS.
 */
@Component({
  selector: 'robot-download-popup',
  standalone: true,
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <div class="popup">
      <span class="model-name">{{ robot().display_name }}</span>

      <span class="meta-row">
        <span class="badge">URDF</span>
        <span class="size">~12 KB</span>
      </span>

      @if (showPlaceholder()) {
        <p class="placeholder">Próximamente</p>
      } @else {
        <button class="download-action" (click)="onDownload()">
          Descargar
        </button>
      }
    </div>
  `,
  styleUrl: './robot-download-popup.scss',
})
export class RobotDownloadPopup {
  readonly robot = input.required<RobotMetadataDto>();
  readonly close = output<void>();

  protected readonly showPlaceholder = signal(false);

  protected onDownload(): void {
    this.showPlaceholder.set(true);
    // TODO: wire to RobotApiService.downloadRobotUrdf() → Blob → createObjectURL
  }
}
