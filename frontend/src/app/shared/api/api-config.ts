import { InjectionToken, ValueProvider } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

export function provideApiBaseUrl(url: string): ValueProvider {
  return { provide: API_BASE_URL, useValue: url };
}
