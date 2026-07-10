import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from './notification.service';

/** Mapa de códigos HTTP a mensajes amigables en español. */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Solicitud inválida. Revise los datos ingresados.',
  401: 'No autorizado. Inicie sesión nuevamente.',
  403: 'Acceso denegado.',
  404: 'El recurso solicitado no fue encontrado.',
  408: 'La solicitud expiró. Intente nuevamente.',
  409: 'Conflicto. El recurso ya existe o está en un estado inconsistente.',
  429: 'Demasiadas solicitudes. Espere un momento e intente nuevamente.',
  500: 'Error interno del servidor. Intente más tarde.',
  502: 'El servidor no está disponible temporalmente.',
  503: 'Servicio no disponible. Intente más tarde.',
  504: 'El servidor tardó demasiado en responder. Verifique su conexión.',
};

/**
 * Interceptor HTTP global — captura errores HTTP y de red,
 * muestra notificaciones amigables via NotificationService.
 *
 * Omite 422 (Unprocessable Entity) porque PlanningPanel
 * tiene su propio parsing específico de errores de planificación.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        // 422 tiene manejo específico en PlanningPanel
        if (error.status === 422) {
          return throwError(() => error);
        }

        const message =
          STATUS_MESSAGES[error.status] ??
          error.statusText ??
          'Error de conexión. Verifique que el servidor esté corriendo.';

        notifications.error(message);
      } else {
        notifications.error('Error inesperado. Intente nuevamente.');
      }

      return throwError(() => error);
    }),
  );
};
