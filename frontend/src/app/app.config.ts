import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideIcons } from '@ng-icons/core';
import {
  heroChartBar,
  heroClipboardDocumentList,
  heroPlay,
  heroCamera,
  heroClock,
  heroDocumentText,
  heroCpuChip,
  heroWrenchScrewdriver,
  heroRectangleGroup,
  heroArrowUpOnSquare,
} from '@ng-icons/heroicons/outline';
import { provideApiBaseUrl } from './shared/api/api-config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideApiBaseUrl('http://localhost:3000/api/v1'),
    provideIcons({
      heroChartBar,
      heroClipboardDocumentList,
      heroPlay,
      heroCamera,
      heroClock,
      heroDocumentText,
      heroCpuChip,
      heroWrenchScrewdriver,
      heroRectangleGroup,
      heroArrowUpOnSquare,
    }),
  ],
};
