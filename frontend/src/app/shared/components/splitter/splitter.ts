import {
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { LayoutStore } from '../../store/layout.store';

type PanelId = 'left' | 'right' | 'bottom';

/**
 * Thin drag handle between panels.
 *
 * Usage:
 *   <app-splitter direction="vertical" panel="left" />
 */
@Component({
  selector: 'app-splitter',
  standalone: true,
  template: `
    <div
      class="splitter"
      [class.splitter--vertical]="direction() === 'vertical'"
      [class.splitter--horizontal]="direction() === 'horizontal'"
      [class.splitter--dragging]="dragging()"
      (mousedown)="onMouseDown($event)"
    >
      <div class="splitter__grip">
        <div class="splitter__grip-dot"></div>
        <div class="splitter__grip-dot"></div>
      </div>
    </div>
  `,
  styles: `
    :host {
      flex-shrink: 0;
      z-index: 10;
    }

    .splitter {
      position: relative;
      background: transparent;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover,
      &--dragging {
        background: #3399ff33;
      }

      &--vertical {
        width: 6px;
        cursor: col-resize;
      }

      &--horizontal {
        height: 6px;
        cursor: row-resize;
      }

      &__grip {
        display: flex;
        flex-direction: column;
        gap: 3px;
        pointer-events: none;
        opacity: 0.4;
      }

      &--horizontal &__grip {
        flex-direction: row;
      }

      &__grip-dot {
        width: 2px;
        height: 2px;
        border-radius: 50%;
        background: #666;
      }
    }
  `,
})
export class Splitter {
  readonly direction = input.required<'vertical' | 'horizontal'>();
  readonly panel = input.required<PanelId>();

  private readonly layout = inject(LayoutStore);

  protected readonly dragging = signal(false);

  private startPos = 0;
  private startSize = 0;

  protected onMouseDown(event: MouseEvent): void {
    event.preventDefault();

    this.dragging.set(true);
    this.startPos = this.direction() === 'vertical' ? event.clientX : event.clientY;

    switch (this.panel()) {
      case 'left':
        this.startSize = this.layout.leftWidth();
        break;
      case 'right':
        this.startSize = this.layout.rightWidth();
        break;
      case 'bottom':
        this.startSize = this.layout.bottomHeight();
        break;
    }

    const onMove = (e: MouseEvent) => {
      const currentPos = this.direction() === 'vertical' ? e.clientX : e.clientY;
      const delta = currentPos - this.startPos;

      switch (this.panel()) {
        case 'left':
          this.layout.setLeftWidth(this.startSize + delta);
          break;
        case 'right':
          this.layout.setRightWidth(this.startSize - delta);
          break;
        case 'bottom':
          this.layout.setBottomHeight(this.startSize - delta);
          break;
      }
    };

    const onUp = () => {
      this.dragging.set(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = this.direction() === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }
}
