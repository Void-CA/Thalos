import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  durationMs: number;
}

/**
 * Servicio compartido de notificaciones — toasts globales para toda la app.
 * Basado en signals, sin dependencias externas.
 * Los componentes pueden suscribirse a `notifications()` para renderizar.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly notifications = signal<AppNotification[]>([]);

  private readonly defaults = {
    success: 3000,
    error: 8000,
    warning: 5000,
    info: 4000,
  };

  /** Muestra una notificación con auto-dismiss. */
  show(type: NotificationType, message: string, durationMs?: number): string {
    const id = crypto.randomUUID();
    const ms = durationMs ?? this.defaults[type];

    this.notifications.update(list => [...list, { id, type, message, durationMs: ms }]);

    if (ms > 0) {
      setTimeout(() => this.dismiss(id), ms);
    }

    return id;
  }

  /** Muestra un error con mensaje amigable. */
  error(message: string, durationMs?: number): string {
    return this.show('error', message, durationMs);
  }

  /** Muestra un éxito. */
  success(message: string, durationMs?: number): string {
    return this.show('success', message, durationMs);
  }

  /** Muestra una advertencia. */
  warning(message: string, durationMs?: number): string {
    return this.show('warning', message, durationMs);
  }

  /** Muestra un info. */
  info(message: string, durationMs?: number): string {
    return this.show('info', message, durationMs);
  }

  /** Descarta una notificación por ID. */
  dismiss(id: string): void {
    this.notifications.update(list => list.filter(n => n.id !== id));
  }

  /** Descarta todas las notificaciones. */
  clear(): void {
    this.notifications.set([]);
  }
}
