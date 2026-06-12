import { Component, inject } from '@angular/core';
import { ModeStore } from '../../store/mode.store';
import type { AppMode } from '../../types/app-mode';

@Component({
  selector: 'top-bar',
  standalone: true,
  template: `
    <header class="top-bar">
      <div class="top-bar__mode-group">
        <span class="top-bar__label">Mode</span>
        <div class="top-bar__mode-selector">
          @for (m of modes; track m) {
            <button
              class="top-bar__mode-btn"
              [class.active]="store.mode() === m"
              (click)="store.setMode(m)"
            >
              {{ m }}
            </button>
          }
        </div>
      </div>

      <div class="top-bar__spacer"></div>

      <div class="top-bar__status">
        <span class="top-bar__dot top-bar__dot--online"></span>
        <span class="top-bar__status-text">Connected</span>
      </div>
    </header>
  `,
  styleUrl: './top-bar.scss',
})
export class TopBar {
  protected readonly store = inject(ModeStore);
  protected readonly modes: AppMode[] = ['analysis', 'planning', 'execution'];
}
