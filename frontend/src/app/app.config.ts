import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideIcons } from '@ng-icons/core';
import { provideEchartsCore } from 'ngx-echarts';
import {
  heroChartBar,
  heroClipboardDocumentList,
  heroClipboardDocumentCheck,
  heroPlay,
  heroCamera,
  heroClock,
  heroDocumentText,
  heroCpuChip,
  heroWrenchScrewdriver,
  heroAdjustmentsVertical,
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
      heroClipboardDocumentCheck,
      heroPlay,
      heroCamera,
      heroClock,
      heroDocumentText,
      heroCpuChip,
      heroWrenchScrewdriver,
      heroAdjustmentsVertical,
      heroRectangleGroup,
      heroArrowUpOnSquare,
    }),
    provideEchartsCore({ echarts: () => import('echarts') }),
  ],
};
