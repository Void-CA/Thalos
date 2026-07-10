import { Component, inject } from '@angular/core';
import { NotificationService } from '../../services/notification.service';

/**
 * Host flotante para notificaciones toast.
 * Se renderiza en el root del layout, sobre todo el contenido.
 */
@Component({
  selector: 'notification-host',
  standalone: true,
  template: `
    <div class="toast-container">
      @for (n of notifications.notifications(); track n.id) {
        <div
          class="toast"
          [class.toast--success]="n.type === 'success'"
          [class.toast--error]="n.type === 'error'"
          [class.toast--warning]="n.type === 'warning'"
          [class.toast--info]="n.type === 'info'"
          (click)="notifications.dismiss(n.id)"
        >
          <span class="toast__msg">{{ n.message }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-container {
      position: fixed;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      pointer-events: none;
      max-width: 380px;
    }

    .toast {
      pointer-events: auto;
      font-family: monospace;
      font-size: 0.78rem;
      padding: 0.55rem 0.85rem;
      border-radius: 4px;
      border: 1px solid;
      animation: toastSlide 0.2s ease-out;
      cursor: pointer;
      line-height: 1.4;
    }

    .toast--success {
      background: #1a3a1a;
      color: #44cc44;
      border-color: #2a5a2a;
    }

    .toast--error {
      background: #3a1a1a;
      color: #cc4444;
      border-color: #5a2a2a;
    }

    .toast--warning {
      background: #3a3010;
      color: #eebb44;
      border-color: #5a4a1a;
    }

    .toast--info {
      background: #1a2a3a;
      color: #44aacc;
      border-color: #2a4a5a;
    }

    .toast__msg {
      display: block;
    }

    @keyframes toastSlide {
      from {
        opacity: 0;
        transform: translateX(30px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `,
})
export class NotificationHost {
  protected readonly notifications = inject(NotificationService);
}
