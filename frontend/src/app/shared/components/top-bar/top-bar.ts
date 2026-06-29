import { Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { ModeStore } from '../../store/mode.store';
import type { AppMode } from '../../types/app-mode';

const MODE_ICONS: Record<AppMode, string> = {
  analysis: 'heroChartBar',
  planning: 'heroClipboardDocumentList',
  execution: 'heroPlay',
};

@Component({
  selector: 'top-bar',
  standalone: true,
  imports: [NgIcon],
  template: `
    <header class="top-bar">
      <nav class="top-bar__tabs">
        @for (m of modes; track m) {
          <button
            class="top-bar__tab"
            [class.top-bar__tab--active]="store.mode() === m"
            (click)="store.setMode(m)"
          >
            <ng-icon class="top-bar__icon" [name]="MODE_ICONS[m]" size="20" />
            <span>{{ m }}</span>
          </button>
        }
      </nav>

      <div class="top-bar__spacer"></div>
    </header>
  `,
  styleUrl: './top-bar.scss',
})
export class TopBar {
  protected readonly MODE_ICONS = MODE_ICONS;
  protected readonly store = inject(ModeStore);
  protected readonly modes: AppMode[] = ['analysis', 'planning', 'execution'];
}
