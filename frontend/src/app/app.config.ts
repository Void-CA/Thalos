import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideApiBaseUrl } from './shared/api/api-config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideApiBaseUrl('http://localhost:3000/api/v1'),
  ],
};
