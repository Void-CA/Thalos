import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { httpErrorInterceptor } from './shared/services/http-error.interceptor';
import { provideApiBaseUrl } from './shared/api/api-config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([httpErrorInterceptor])),
    provideApiBaseUrl('http://localhost:3000/api/v1'),
  ],
};
