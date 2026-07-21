import { Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { PerspectiveStore } from '../../store/perspective.store';
import { PERSPECTIVE_LABELS, PERSPECTIVE_ICONS } from '../../types/perspective-registry';
import type { Perspective } from '../../types/perspective';

@Component({
  selector: 'top-bar',
  standalone: true,
  imports: [NgIcon],
  template: `
    <header class="top-bar">
      <nav class="top-bar__tabs">
        @for (p of perspectives; track p) {
          <button
            class="top-bar__tab"
            [class.top-bar__tab--active]="store.perspective() === p"
            (click)="store.setPerspective(p)"
          >
            <ng-icon class="top-bar__icon" [name]="PERSPECTIVE_ICONS[p]" size="20" />
            <span>{{ PERSPECTIVE_LABELS[p] }}</span>
          </button>
        }
      </nav>

      <div class="top-bar__spacer"></div>
    </header>
  `,
  styleUrl: './top-bar.scss',
})
export class TopBar {
  protected readonly PERSPECTIVE_LABELS = PERSPECTIVE_LABELS;
  protected readonly PERSPECTIVE_ICONS = PERSPECTIVE_ICONS;
  protected readonly store = inject(PerspectiveStore);
  protected readonly perspectives: Perspective[] = ['robot', 'planning', 'analysis', 'execution', 'knowledge', 'sessions'];
}
